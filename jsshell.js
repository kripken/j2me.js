/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

function check() {

}

if (scriptArgs.length !== 1) {
  print("error: One main class name must be specified.");
  print("usage: jsshell <main class name>");
  quit(1);
}

var window = {
  setZeroTimeout: function(callback) {
    callback();
  },
  addEventListener: function() {
  },
  crypto: {
    getRandomValues: function() {
    },
  },
};

var navigator = {
  language: "en-US",
};

var document = {
  documentElement: {
    classList: {
      add: function() {
      },
    },
  },
  querySelector: function() {
    return {
      addEventListener: function() {
      },
    };
  },
  getElementById: function() {
    return {
      addEventListener: function() {
      },
      getContext: function() {
      },
      getBoundingClientRect: function() {
        return { top: 0, left: 0, width: 0, height: 0 };
      }
    };
  },
  addEventListener: function() {
  },
};

var urlParams = {
  logConsole: "native",
  args: "",
};

try {
  load("libs/zipfile.js", "blackBox.js", "build/j2me.js", "classfile/classfile.js",
       "classfile/reader.js", "classfile/tags.js", "classfile/attributetypes.js",
       "libs/encoding.js", "util.js", "frame.js",
       "classfile/accessflags.js", "instrument.js", "signature.js", "opcodes.js",
       "override.js", "native.js", "tests/override.js", 
       "string.js", "libs/console.js", "midp/midp.js",
       "libs/long.js", "midp/crypto.js", "libs/forge/md5.js", "libs/forge/util.js");//, "build/compiled.js");

  var dump = putstr;
  var console = window.console;

  CLASSES.addSourceDirectory("java/cldc1.1.1");
  CLASSES.addSourceDirectory("java/midp");
  //CLASSES.addSourceDirectory("bench/scimark2src");

  CLASSES.addPath("java/classes.jar", snarf("java/classes.jar", "binary").buffer);
  CLASSES.addPath("tests/tests.jar", snarf("tests/tests.jar", "binary").buffer);
  //CLASSES.addPath("bench/scimark2.jar", snarf("bench/scimark2.jar", "binary").buffer);

  CLASSES.initializeBuiltinClasses();

  var start = dateNow();
  var jvm = new JVM();

  print("INITIALIZATION TIME: " + (dateNow() - start));

  start = dateNow();
  var runtime = jvm.startIsolate0(scriptArgs[0], urlParams.args);

  print("RUNNING TIME: " + (dateNow() - start));

  // J2ME.interpreterCounter.traceSorted(new J2ME.IndentingWriter());

} catch (x) {
  print(x);
  print(x.stack);
}
