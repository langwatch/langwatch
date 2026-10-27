// Command importext rewrites relative import specifiers in TypeScript sources
// so every one names the file it resolves to on disk, which is what Node's
// native type stripping requires.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/importext"
)

func main() {
	os.Exit(importext.Run(os.Args[1:], importext.Streams{Out: os.Stdout, Err: os.Stderr}))
}
