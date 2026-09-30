// Command featureparity fails when an enforced scenario in a .feature file is
// bound to no test by a `@scenario "<title>"` annotation.
//
// Usage: featureparity [--json] [-cpuprofile file] [-memprofile file]
//
// The rules live in tools/featureparity; this is only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/cliprof"
	"github.com/langwatch/langwatch/tools/featureparity"
)

func main() {
	args, stop := cliprof.Start(os.Args[1:], os.Stderr)
	code := featureparity.Run(args, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
