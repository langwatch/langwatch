// Command devscripts runs the repository's small dev scripts as one binary:
// generate-modules, sync-references and ensure-built.
//
// Usage: devscripts [-cpuprofile file] [-memprofile file] <subcommand> [args]
//
// The subcommands live in tools/devscripts; this is only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/cliprof"
	"github.com/langwatch/langwatch/tools/devscripts"
)

func main() {
	args, stop := cliprof.Start(os.Args[1:], os.Stderr)
	code := devscripts.Run(args, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
