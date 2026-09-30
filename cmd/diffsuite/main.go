// Command diffsuite runs the diff tools together and stops them all when the
// policy says so. See tools/diffsuite/README.md.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/diffsuite"
)

func main() {
	os.Exit(diffsuite.Run(os.Args[1:], os.Stderr))
}
