// Command lanediff diffs the worker job registries of two refs and
// classifies every lane, pipeline and process manager the newer one drops.
//
// Usage: lanediff [-base origin/main] [-head HEAD] [-root .] [-rules FILE]
//
// The rules live in tools/lane-diff; this is only the process shell.
package main

import (
	"os"

	lanediff "github.com/langwatch/langwatch/tools/lane-diff"
)

func main() {
	os.Exit(lanediff.Run(os.Args[1:], os.Stdout, os.Stderr))
}
