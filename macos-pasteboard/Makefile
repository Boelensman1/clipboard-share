prefix ?= /usr/local
bindir ?= $(prefix)/bin
CFLAGS := -O

all: bin/pbv

bin/pbv: $(wildcard *.swift)
	@mkdir -p $(@D)
	xcrun -sdk macosx swiftc $+ $(CFLAGS) -o $@

uninstall:
	rm -f $(DESTDIR)$(bindir)/pbv

clean:
	rm -f bin/pbv

test:
	swiftformat --lint *.swift
	swiftlint lint *.swift
