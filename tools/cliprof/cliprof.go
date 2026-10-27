// Package cliprof gives every Go tool (cmd/* included, so it is not internal) the same -cpuprofile and -memprofile
// flags, taken out of argv before the tool parses its own arguments.
package cliprof

import (
	"fmt"
	"io"
	"os"
	"runtime"
	"runtime/pprof"
	"strings"
)

// Start strips -cpuprofile/-memprofile (one or two dashes, `=` or a separate
// value) from args, starts the CPU profile, and returns the remaining args and
// a stop func that writes both profiles. Call stop before os.Exit.
func Start(args []string, stderr io.Writer) (rest []string, stop func()) {
	rest, cpu, mem := split(args)
	if cpu != "" {
		startCPU(cpu, stderr)
	}
	return rest, func() {
		pprof.StopCPUProfile()
		if mem != "" {
			writeHeap(mem, stderr)
		}
	}
}

// split takes the two profile flags out of args.
func split(args []string) (rest []string, cpu, mem string) {
	for i := 0; i < len(args); i++ {
		name, value, hasValue := strings.Cut(strings.TrimLeft(args[i], "-"), "=")
		target := map[string]*string{"cpuprofile": &cpu, "memprofile": &mem}[name]
		if target == nil || !strings.HasPrefix(args[i], "-") {
			rest = append(rest, args[i])
			continue
		}
		if !hasValue && i+1 < len(args) {
			i++
			value = args[i]
		}
		*target = value
	}
	return rest, cpu, mem
}

func startCPU(path string, stderr io.Writer) {
	f, err := os.Create(path)
	if err == nil {
		err = pprof.StartCPUProfile(f)
	}
	if err != nil {
		fmt.Fprintln(stderr, "cpuprofile:", err)
	}
}

func writeHeap(path string, stderr io.Writer) {
	f, err := os.Create(path)
	if err == nil {
		runtime.GC()
		err = pprof.Lookup("allocs").WriteTo(f, 0)
		f.Close()
	}
	if err != nil {
		fmt.Fprintln(stderr, "memprofile:", err)
	}
}
