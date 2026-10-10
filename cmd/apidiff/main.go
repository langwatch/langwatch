package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/apidiff"
)

func main() {
	os.Exit(apidiff.Run(os.Args[1:], os.Stdout, os.Stderr))
}
