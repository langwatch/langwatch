// Command disposabledomains refreshes the sign-up policy's vendored copy of the
// community disposable-email-domains list, pinned to the upstream commit it read.
//
// Usage: disposabledomains [-root .] [-commit <sha>]
//
// The rules live in tools/disposabledomains; this is only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/disposabledomains"
)

func main() {
	os.Exit(disposabledomains.Run(os.Args[1:], os.Stdout, os.Stderr))
}
