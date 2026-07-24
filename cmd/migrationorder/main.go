// Command migrationorder fails when a branch adds a migration numbered below one
// that is already on the base branch.
//
// Usage: migrationorder [-base origin/main] [-root .] [-json]
//
// The rules live in tools/migrationorder; this is only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/migrationorder"
)

func main() {
	os.Exit(migrationorder.Run(os.Args[1:], os.Stdout, os.Stderr))
}
