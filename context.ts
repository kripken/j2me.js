module J2ME {
  import assert = Debug.assert;
  declare var VM;
  declare var Instrument;
  declare var setZeroTimeout;
  declare var Long;
  declare var JavaException;

  export class Frame {
    methodInfo: MethodInfo;
    locals: any [];
    stack: any [];
    code: Uint8Array;
    codeS: Int8Array;
    codeLen: number;
    code16: Uint16Array;
    codeS16: Int16Array;
    code32: Uint32Array;
    codeS32: Int32Array;
    bci: number;
    cp: any;
    localsBase: number;
    lockObject: java.lang.Object;
    profileData: any;

    constructor(methodInfo: MethodInfo, locals: any [], localsBase: number) {
      this.methodInfo = methodInfo;
      this.cp = methodInfo.classInfo.constant_pool;

      this.code = methodInfo.code;
      this.codeS = new Int8Array(this.code.buffer);
      if (this.code.length & 3) { // make sure it is of a size we can construct larger views upon
        // TODO: ArrayBuffer.transfer?
        this.code = new Uint8Array((this.code.length + 4) & ~3);
        this.code.set(methodInfo.code);
      }
      var len = this.codeLen = this.code.length;
      var flipped = new Uint8Array(len);
      for (var i = 0; i < len; i++) {
        flipped[i] = this.code[len-i-1];
      }
      this.code16  = new Uint16Array(flipped.buffer);
      this.codeS16 = new Int16Array(flipped.buffer);
      this.code32  = new Uint32Array(flipped.buffer);
      this.codeS32 = new Int32Array(flipped.buffer);

      this.bci = 0;
      this.stack = [];
      this.locals = locals;
      this.localsBase = localsBase;
      this.lockObject = null;
      this.profileData = null;
    }

    getLocal(i: number): any {
      return this.locals[this.localsBase + i];
    }

    setLocal(i: number, value: any) {
      this.locals[this.localsBase + i] = value;
    }

    read8(): number {
      return this.code[this.bci++];
    }

    read16(): number {
      var flip = this.codeLen - this.bci - 2;
      if (flip & 1) {
        return this.read8() << 8 | this.read8();
      }
      var ret = this.code16[flip >> 1];
      this.bci += 2;
      return ret;
    }

    read32(): number {
      var flip = this.codeLen - this.bci - 4;
      if (flip & 3) {
        return this.read16() << 16 | this.read16();
      }
      var ret = this.code32[flip >> 2];
      this.bci += 4;
      return ret;
    }

    read8signed(): number {
      return this.codeS[this.bci++];
    }

    read16signed(): number {
      var flip = this.codeLen - this.bci - 2;
      if (flip & 1) {
        var x = this.read8() << 8 | this.read8();
        return (x > 0x7fff) ? (x - 0x10000) : x;
      }
      var ret = this.codeS16[flip >> 1];
      this.bci += 2;
      return ret;
    }

    read32signed(): number {
      var flip = this.codeLen - this.bci - 4;
      if (flip & 3) {
        var x = this.read16() << 16 | this.read16();
        return (x > 0x7fffffff) ? (x - 0x100000000) : x;
      }
      var ret = this.codeS32[flip >> 2];
      this.bci += 4;
      return ret;
    }

    /**
     * Returns the |object| on which a call to the specified |methodInfo| would be
     * called.
     */
    peekInvokeObject(methodInfo: MethodInfo): java.lang.Object {
      release || assert(!methodInfo.isStatic);
      var argumentSlotCount = methodInfo.signatureDescriptor.getArgumentSlotCount();
      var i = this.stack.length - argumentSlotCount - 1;
      release || assert (i >= 0);
      release || assert (this.stack[i] !== undefined);
      return this.stack[i];
    }

    popArguments(signatureDescriptor: SignatureDescriptor): any [] {
      var stack = this.stack;
      var typeDescriptors = signatureDescriptor.typeDescriptors;
      var argumentSlotCount = signatureDescriptor.getArgumentSlotCount();
      var args = new Array(signatureDescriptor.getArgumentCount());
      for (var i = 1, j = stack.length - argumentSlotCount, k = 0; i < typeDescriptors.length; i++) {
        var typeDescriptor = typeDescriptors[i];
        args[k++] = stack[j++];
        if (isTwoSlot(typeDescriptor.kind)) {
          j++;
        }
      }
      release || assert(j === stack.length && k === signatureDescriptor.getArgumentCount());
      stack.length -= argumentSlotCount;
      return args;
    }

    trace(writer: IndentingWriter) {
      var localsStr = this.locals.map(function (x) {
        return toDebugString(x);
      }).join(", ");

      var stackStr = this.stack.map(function (x) {
        return toDebugString(x);
      }).join(", ");

      writer.writeLn(this.bci + " " + localsStr + " | " + stackStr);
    }
  }

  export class Context {
    private static _nextId: number = 0;
    private static _colors = [
      IndentingWriter.PURPLE,
      IndentingWriter.YELLOW,
      IndentingWriter.GREEN,
      IndentingWriter.RED,
      IndentingWriter.BOLD_RED
    ];
    id: number
    frames: any [];
    frameSets: any [];
    bailoutFrames: any [];
    lockTimeout: number;
    lockLevel: number;
    thread: java.lang.Thread;
    writer: IndentingWriter;
    constructor(public runtime: Runtime) {
      var id = this.id = Context._nextId ++;
      this.frames = [];
      this.frameSets = [];
      this.bailoutFrames = [];
      this.runtime = runtime;
      this.runtime.addContext(this);
      this.writer = new IndentingWriter(false, function (s) {
        console.log(s);
      });
    }

    public static color(id) {
      if (inBrowser) {
        return id;
      }
      return Context._colors[id % Context._colors.length] + id + IndentingWriter.ENDC;
    }
    public static currentContextPrefix() {
      if ($) {
        return Context.color($.id) + ":" + Context.color($.ctx.id);
      }
      return "";
    }

    kill() {
      if (this.thread) {
        this.thread.alive = false;
      }
      this.runtime.removeContext(this);
    }

    current() {
      var frames = this.frames;
      return frames[frames.length - 1];
    }

    popFrame() {
      var callee = this.frames.pop();
      if (this.frames.length === 0) {
        return null;
      }
      var caller = this.current();
      Instrument.callExitHooks(callee.methodInfo, caller, callee);
      return caller;
    }

    executeNewFrameSet(frames: Frame []) {
      var self = this;
      function flattenFrameSet() {
        // Append all the current frames to the parent frame set, so a single frame stack
        // exists when the bailout finishes.
        var currentFrames = self.frames;
        self.frames = self.frameSets.pop();
        for (var i = currentFrames.length - 1; i >= 0; i--) {
          self.bailoutFrames.unshift(currentFrames[i]);
        }
      }
      this.frameSets.push(this.frames);
      this.frames = frames;
      try {
        if (traceWriter) {
          var firstFrame = frames[0];
          var frameDetails = firstFrame.methodInfo.classInfo.className + "/" + firstFrame.methodInfo.name + signatureToDefinition(firstFrame.methodInfo.signature, true, true);
          traceWriter.enter("> " + MethodType[MethodType.Interpreted][0] + " " + frameDetails);
        }
        var returnValue = VM.execute(this);
        if (U) {
          flattenFrameSet();
          return;
        }
        if (traceWriter) {
          traceWriter.leave("<");
        }
      } catch (e) {
        if (traceWriter) {
          traceWriter.leave("< " + e);
        }
        assert(this.frames.length === 0);
        this.frames = this.frameSets.pop();
        throwHelper(e);
      }
      this.frames = this.frameSets.pop();
      return returnValue;
    }

    getClassInitFrame(classInfo: ClassInfo) {
      if (this.runtime.initialized[classInfo.className])
        return;
      classInfo.thread = this.thread;
      var syntheticMethod = new MethodInfo({
        name: "ClassInitSynthetic",
        signature: "()V",
        isStatic: false,
        classInfo: {
          className: classInfo.className,
          vmc: {},
          vfc: {},
          constant_pool: [
            null,
            {tag: TAGS.CONSTANT_Methodref, class_index: 2, name_and_type_index: 4},
            {tag: TAGS.CONSTANT_Class, name_index: 3},
            {bytes: "java/lang/Class"},
            {name_index: 5, signature_index: 6},
            {bytes: "invoke_clinit"},
            {bytes: "()V"},
            {tag: TAGS.CONSTANT_Methodref, class_index: 2, name_and_type_index: 8},
            {name_index: 9, signature_index: 10},
            {bytes: "init9"},
            {bytes: "()V"},
          ],
        },
        code: new Uint8Array([
          0x2a,             // aload_0
          0x59,             // dup
          0x59,             // dup
          0x59,             // dup
          0xc2,             // monitorenter
          0xb7, 0x00, 0x01, // invokespecial <idx=1>
          0xb7, 0x00, 0x07, // invokespecial <idx=7>
          0xc3,             // monitorexit
          0xb1,             // return
        ])
      });
      return new Frame(syntheticMethod, [classInfo.getClassInitLockObject(this)], 0);
    }

    pushClassInitFrame(classInfo: ClassInfo) {
      if (this.runtime.initialized[classInfo.className])
        return;
      var classInitFrame = this.getClassInitFrame(classInfo);
      this.executeNewFrameSet([classInitFrame]);
    }

    createException(className, message?) {
      if (!message)
        message = "";
      message = "" + message;
      var classInfo = CLASSES.getClass(className);

      var exception = new classInfo.klass();
      var methodInfo = CLASSES.getMethod(classInfo, "I.<init>.(Ljava/lang/String;)V");
      jsGlobal[methodInfo.mangledClassAndMethodName].call(exception, message ? $S(message) : null);

      return exception;
    }

    setCurrent() {
      $ = this.runtime;
      if ($.ctx === this) {
        return;
      }
      $.ctx = this;
      traceWriter = null; // this.writer;
      linkWriter = null; // this.writer;
      initWriter = null; // this.writer;
    }

    execute() {
      Instrument.callResumeHooks(this.current());
      this.setCurrent();
      do {
        VM.execute(this);
        if (U) {
          Array.prototype.push.apply(this.frames, this.bailoutFrames);
          this.bailoutFrames = [];
        }
        if (U === VMState.Yielding) {
          // Ignore the yield and continue executing instructions on this thread.
          U = VMState.Running;
          continue;
        } else if (U === VMState.Pausing) {
          U = VMState.Running;
          Instrument.callPauseHooks(this.current());
          return;
        }
      } while (this.frames.length !== 0);
    }

    start() {
      var ctx = this;
      this.setCurrent();
      Instrument.callResumeHooks(ctx.current());
      VM.execute(ctx);
      if (U) {
        Array.prototype.push.apply(this.frames, this.bailoutFrames);
        this.bailoutFrames = [];
      }
      if (U === VMState.Pausing) {
        U = VMState.Running;
        Instrument.callPauseHooks(this.current());
        return;
      }
      U = VMState.Running;
      Instrument.callPauseHooks(ctx.current());

      if (ctx.frames.length === 0) {
        ctx.kill();
        return;
      }

      ctx.resume();
    }

    resume() {
      (<any>window).setZeroTimeout(this.start.bind(this));
    }

    block(obj, queue, lockLevel) {
      if (!obj[queue])
        obj[queue] = [];
      obj[queue].push(this);
      this.lockLevel = lockLevel;
      $.pause();
    }

    unblock(obj, queue, notifyAll, callback) {
      while (obj[queue] && obj[queue].length) {
        var ctx = obj[queue].pop();
        if (!ctx)
          continue;
        // Wait until next tick, so that we are sure to notify all waiting.
        (<any>window).setZeroTimeout(callback.bind(null, ctx));
        if (!notifyAll)
          break;
      }
    }

    wakeup(obj) {
      if (this.lockTimeout !== null) {
        window.clearTimeout(this.lockTimeout);
        this.lockTimeout = null;
      }
      if (obj._lock) {
        if (!obj.ready)
          obj.ready = [];
        obj.ready.push(this);
      } else {
        while (this.lockLevel-- > 0) {
          this.monitorEnter(obj);
          if (U === VMState.Pausing) {
            return;
          }
        }
        this.resume();
      }
    }

    monitorEnter(obj: java.lang.Object) {
      var lock = obj._lock;
      if (!lock) {
        obj._lock = new Lock(this.thread, 1);
        return;
      }
      if (lock.thread === this.thread) {
        ++lock.level;
        return;
      }
      this.block(obj, "ready", 1);
    }

    monitorExit(obj: java.lang.Object) {
      var lock = obj._lock;
      if (lock.thread !== this.thread)
        throw this.createException("java/lang/IllegalMonitorStateException");
      if (--lock.level > 0) {
        return;
      }
      obj._lock = null;
      this.unblock(obj, "ready", false, function (ctx) {
        ctx.wakeup(obj);
      });
    }

    wait(obj, timeout) {
      var lock = obj._lock;
      if (timeout < 0)
        throw this.createException("java/lang/IllegalArgumentException");
      if (!lock || lock.thread !== this.thread)
        throw this.createException("java/lang/IllegalMonitorStateException");
      var lockLevel = lock.level;
      while (lock.level > 0)
        this.monitorExit(obj);
      if (timeout) {
        var self = this;
        this.lockTimeout = window.setTimeout(function () {
          obj.waiting.forEach(function (ctx, n) {
            if (ctx === self) {
              obj.waiting[n] = null;
              ctx.wakeup(obj);
            }
          });
        }, timeout);
      } else {
        this.lockTimeout = null;
      }
      this.block(obj, "waiting", lockLevel);
    }

    notify(obj, notifyAll) {
      if (!obj._lock || obj._lock.thread !== this.thread)
        throw this.createException("java/lang/IllegalMonitorStateException");

      this.unblock(obj, "waiting", notifyAll, function (ctx) {
        ctx.wakeup(obj);
      });
    }

    bailout(methodInfo: MethodInfo, bci: number, local: any [], stack: any []) {
      var frame = new Frame(methodInfo, local, 0);
      frame.stack = stack;
      frame.bci = bci;
      this.bailoutFrames.unshift(frame);
    }

    resolve(cp, idx: number, isStatic: boolean) {
      var constant = cp[idx];
      if (!constant.tag)
        return constant;
      switch (constant.tag) {
        case 3: // TAGS.CONSTANT_Integer
          constant = constant.integer;
          break;
        case 4: // TAGS.CONSTANT_Float
          constant = constant.float;
          break;
        case 8: // TAGS.CONSTANT_String
          constant = this.runtime.newStringConstant(cp[constant.string_index].bytes);
          break;
        case 5: // TAGS.CONSTANT_Long
          constant = Long.fromBits(constant.lowBits, constant.highBits);
          break;
        case 6: // TAGS.CONSTANT_Double
          constant = constant.double;
          break;
        case 7: // TAGS.CONSTANT_Class
          constant = CLASSES.getClass(cp[constant.name_index].bytes);
          break;
        case 9: // TAGS.CONSTANT_Fieldref
          var classInfo = this.resolve(cp, constant.class_index, isStatic);
          var fieldName = cp[cp[constant.name_and_type_index].name_index].bytes;
          var signature = cp[cp[constant.name_and_type_index].signature_index].bytes;
          constant = CLASSES.getField(classInfo, (isStatic ? "S" : "I") + "." + fieldName + "." + signature);
          if (!constant) {
            throw new JavaException("java/lang/RuntimeException",
              classInfo.className + "." + fieldName + "." + signature + " not found");
          }
          break;
        case 10: // TAGS.CONSTANT_Methodref
        case 11: // TAGS.CONSTANT_InterfaceMethodref
          var classInfo = this.resolve(cp, constant.class_index, isStatic);
          var methodName = cp[cp[constant.name_and_type_index].name_index].bytes;
          var signature = cp[cp[constant.name_and_type_index].signature_index].bytes;
          constant = CLASSES.getMethod(classInfo, (isStatic ? "S" : "I") + "." + methodName + "." + signature);
          if (!constant) {
            throw new JavaException("java/lang/RuntimeException",
              classInfo.className + "." + methodName + "." + signature + " not found");
          }
          break;
        default:
          throw new Error("not support constant type");
      }
      return constant;
    }
  }
}

var Context = J2ME.Context;
var Frame = J2ME.Frame;
