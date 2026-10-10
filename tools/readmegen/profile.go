package readmegen

import (
	"os"
	"runtime"
	"runtime/pprof"
)

// startProfiles starts the CPU profile and returns what writes both profiles.
func startProfiles(opts options) (func(), error) {
	var cpu *os.File
	if opts.cpuprof != "" {
		file, err := os.Create(opts.cpuprof)
		if err != nil {
			return nil, err
		}
		if err := pprof.StartCPUProfile(file); err != nil {
			_ = file.Close()
			return nil, err
		}
		cpu = file
	}
	return func() {
		if cpu != nil {
			pprof.StopCPUProfile()
			_ = cpu.Close()
		}
		if opts.memprof == "" {
			return
		}
		file, err := os.Create(opts.memprof)
		if err != nil {
			return
		}
		defer file.Close()
		runtime.GC()
		_ = pprof.Lookup("allocs").WriteTo(file, 0)
	}, nil
}
