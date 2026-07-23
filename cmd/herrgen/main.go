// Command herrgen mirrors the Go services' herr error codes into the
// TypeScript the control plane type-checks against.
//
// Usage: herrgen [-root .] [-out packages/handled-error/src/codes.generated.ts] [-check]
//
// The rules live in tools/herrgen; this is only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/herrgen"
)

func main() {
	os.Exit(herrgen.Run(os.Args[1:], os.Stdout, os.Stderr))
}
