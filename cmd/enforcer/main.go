// Command enforcer is the Go front of the architecture enforcer: the TS CLI's
// flags and report, with ported policies computed in Go and the rest
// delegated to packages/architecture-enforcer in one Node process.
//
// Usage: enforcer [-cpuprofile file] [-memprofile file] [--root path] [--policies a,b] ...
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/cliprof"
	"github.com/langwatch/langwatch/tools/enforcer"
)

func main() {
	args, stop := cliprof.Start(os.Args[1:], os.Stderr)
	code := enforcer.Run(args, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
