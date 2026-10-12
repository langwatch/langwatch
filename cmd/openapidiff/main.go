package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

func main() {
	os.Exit(openapidiff.Run(os.Args[1:], os.Stdout, os.Stderr))
}
