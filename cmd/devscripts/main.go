// Command devscripts runs the repository's small dev scripts as one binary:
// generate-modules, sync-references and ensure-built.
//
// Usage: devscripts [-cpuprofile file] [-memprofile file] <subcommand> [args]
//
// The behaviour lives in tools/devscripts; this is only the process shell.
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"runtime/pprof"

	"github.com/langwatch/langwatch/tools/devscripts"
)

func main() {
	os.Exit(run())
}

func run() int {
	cpuProfile := flag.String("cpuprofile", "", "write a CPU profile to this file")
	memProfile := flag.String("memprofile", "", "write an allocation profile to this file")
	flag.Parse()

	if *memProfile != "" {
		runtime.MemProfileRate = 1
	}
	if *cpuProfile != "" {
		file, err := os.Create(*cpuProfile)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
		defer file.Close()
		if err := pprof.StartCPUProfile(file); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
		defer pprof.StopCPUProfile()
	}
	code := devscripts.Run(flag.Args(), os.Stdout, os.Stderr)
	if *memProfile != "" {
		if err := writeHeap(*memProfile); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
	}
	return code
}

func writeHeap(path string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return pprof.Lookup("allocs").WriteTo(file, 0)
}
