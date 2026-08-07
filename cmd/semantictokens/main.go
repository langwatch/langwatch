// Command semantictokens fails a build when a raw Chakra palette shade reaches
// a color prop in the app's source.
//
// Spec: specs/ci/semantic-color-tokens.feature
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/semantictokens"
)

func main() {
	os.Exit(semantictokens.Run(os.Args[1:], os.Stdout, os.Stderr))
}
