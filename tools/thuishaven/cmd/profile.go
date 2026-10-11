package cmd

import (
	"fmt"
	"os"
	"runtime"
	"runtime/pprof"
	"strings"
)

// profileFlags are the leading `--cpuprofile=FILE` and `--memprofile=FILE`
// flags: `haven --cpuprofile=/tmp/cpu.out gate`. Only leading ones are read,
// so a wrapped command's own flags are never taken.
type profileFlags struct {
	cpu string
	mem string
}

// stripProfileFlags removes the leading profile flags from args.
func stripProfileFlags(args []string) ([]string, profileFlags) {
	var flags profileFlags
	for len(args) > 0 {
		switch {
		case strings.HasPrefix(args[0], "--cpuprofile="):
			flags.cpu = strings.TrimPrefix(args[0], "--cpuprofile=")
		case strings.HasPrefix(args[0], "--memprofile="):
			flags.mem = strings.TrimPrefix(args[0], "--memprofile=")
		default:
			return args, flags
		}
		args = args[1:]
	}
	return args, flags
}

// start begins the CPU profile and returns the function that writes both
// profiles; a profile that cannot be written only warns on stderr.
func (p profileFlags) start() func() {
	if p.mem != "" {
		runtime.MemProfileRate = 1
	}
	stopCPU := startCPUProfile(p.cpu)
	return func() {
		stopCPU()
		writeAllocsProfile(p.mem)
	}
}

// startCPUProfile starts a CPU profile into path and returns its stop.
func startCPUProfile(path string) func() {
	if path == "" {
		return func() {}
	}
	f, err := os.Create(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "haven: cpu profile not started:", err)
		return func() {}
	}
	if err := pprof.StartCPUProfile(f); err != nil {
		fmt.Fprintln(os.Stderr, "haven: cpu profile not started:", err)
		_ = f.Close()
		return func() {}
	}
	return func() {
		pprof.StopCPUProfile()
		_ = f.Close()
	}
}

// writeAllocsProfile writes the allocation profile to path, when one was asked for.
func writeAllocsProfile(path string) {
	if path == "" {
		return
	}
	f, err := os.Create(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "haven: memory profile not written:", err)
		return
	}
	defer func() { _ = f.Close() }()
	if err := pprof.Lookup("allocs").WriteTo(f, 0); err != nil {
		fmt.Fprintln(os.Stderr, "haven: memory profile not written:", err)
	}
}
