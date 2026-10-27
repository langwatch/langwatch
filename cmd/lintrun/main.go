// Command lintrun is the oxlint runner behind `pnpm lint`, `pnpm lint:changed` and
// `pnpm lint:types`.
//
// Usage:
//
//	.bin/lintrun/lintrun [--changed] [--types] [--base <sha>]
//
// Spec: specs/tooling/nx-reruns.feature, specs/tooling/lint-split-unused-directives.feature
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/lintrun"
)

// no-test: a thin wrapper over lintrun.Run, which tools/lintrun/run_test.go covers.
func main() {
	os.Exit(lintrun.Run(os.Args[1:], os.Stdout, os.Stderr))
}
