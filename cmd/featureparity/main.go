// Command featureparity fails when an enforced scenario in a .feature file is
// bound to no test by a `@scenario "<title>"` annotation.
//
// Usage: featureparity [--json] [-cpuprofile file] [-memprofile file]
//
// The rules live in tools/featureparity; this is only the process shell.
package main

import (
	"fmt"
	"os"
	"runtime"
	"runtime/pprof"
	"strings"

	"github.com/langwatch/langwatch/tools/featureparity"
)

func main() {
	args, cpu, mem := profileFlags(os.Args[1:])
	if cpu != "" {
		f, err := os.Create(cpu)
		if err == nil {
			err = pprof.StartCPUProfile(f)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "cpuprofile:", err)
			os.Exit(2)
		}
	}
	code := featureparity.Run(args, os.Stdout, os.Stderr)
	pprof.StopCPUProfile()
	if mem != "" {
		f, err := os.Create(mem)
		if err == nil {
			runtime.GC()
			err = pprof.Lookup("allocs").WriteTo(f, 0)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "memprofile:", err)
		}
	}
	os.Exit(code)
}

// profileFlags takes -cpuprofile/-memprofile (one or two dashes, `=` or a
// separate value) out of args; the rest pass through as the Node tool's argv.
func profileFlags(args []string) (rest []string, cpu, mem string) {
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
