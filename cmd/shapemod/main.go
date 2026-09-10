// Command shapemod moves modules/<m>/server/src/{ports,adapters} files onto
// the strict repository shape, finds dead legacy-transport files, and prints
// the repo-wide ports/adapters inventory. Dry-run by default; --apply writes.
//
// Usage:
//
//	shapemod ports [--apply] [--root .] <module-dir>
//	shapemod dead-transports [--apply] [--root .] <module-dir>...
//	shapemod inventory [--root .]
//
// The rules live in tools/shapemod; this is only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/shapemod"
)

func main() {
	os.Exit(shapemod.Run(os.Args[1:], os.Stdout, os.Stderr))
}
