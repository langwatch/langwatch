// Command fuzz is a generic, non-AI, highly parallel fuzzer for the LangWatch
// API and UI. See tools/fuzz/README.md.
package main

import (
	"context"
	"os"

	"github.com/langwatch/langwatch/tools/fuzz"
)

func main() {
	root, err := os.Getwd()
	if err != nil {
		root = "."
	}
	os.Exit(fuzz.Main(context.Background(), os.Args[1:], fuzz.Streams{Out: os.Stdout, Err: os.Stderr}, root))
}
