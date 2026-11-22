// Command readmegen writes and checks the generated README blocks.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/readmegen"
)

func main() {
	os.Exit(readmegen.Run(os.Args[1:], os.Stdout, os.Stderr))
}
