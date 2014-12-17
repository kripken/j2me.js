.PHONY: all test tests j2me java certs app clean
BASIC_SRCS=$(shell find . -maxdepth 0 -name "*.ts")
JIT_SRCS=$(shell find jit -name "*.ts")

all: java tests j2me

test: all
	rm -f test.log
	killall python Python || true
	python tests/httpServer.py &
	python tests/echoServer.py &
	cd tests && python httpsServer.py &
	cd tests && python sslEchoServer.py &
	cd tests && python waitServers.py
	casperjs --engine=slimerjs test `pwd`/tests/automation.js > test.log
	mkdir test-profile-fs-v1
	casperjs --engine=slimerjs -profile `pwd`/test-profile-fs-v1 `pwd`/tests/fs/make-fs-v1.js >> test.log
	casperjs --engine=slimerjs test -profile `pwd`/test-profile-fs-v1 `pwd`/tests/automation.js >> test.log
	rm -rf test-profile-fs-v1
	killall python Python || true
	python dumplog.py
	if grep -q FAIL test.log; \
	then false; \
	else true; \
	fi

build/j2me.js: $(BASIC_SRCS) $(JIT_SRCS)
	@echo "Building J2ME"
	node tools/tsc.js --sourcemap --target ES5 references.ts -d --out build/j2me.js

build/jsc.js: jsc.ts build/j2me.js
	@echo "Building J2ME JSC CLI"
	node tools/tsc.js --sourcemap --target ES5 jsc.ts --out build/jsc.js

j2me: build/j2me.js build/jsc.js

tests:
	make -C tests

java:
	make -C java

certs:
	make -C certs

# Makes an output/ directory containing the packaged open web app files.
app: java certs
	tools/package.sh

clean:
	rm -f j2me.js `find . -name "*~"`
	make -C tests clean
	make -C java clean
