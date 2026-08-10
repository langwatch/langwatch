// Command ciguard asserts the invariants CI has about itself.
//
// They regress silently, which is why they are asserted rather than reviewed:
// a new job that forgets the sparse-checkout does not fail, it just pulls
// 165 MB of media it never reads, and nobody notices until somebody measures
// a checkout again.
//
// Usage:
//
//	go run ./cmd/ciguard            # from anywhere in the tree
//	go run ./cmd/ciguard -root .    # explicit root
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ciguard"
)

type guard struct {
	name string
	run  func(string) ([]string, error)
}

func main() {
	root := flag.String("root", "", "repository root (default: nearest ancestor holding go.work)")
	flag.Parse()

	repoRoot := *root
	if repoRoot == "" {
		found, err := ciscan.RepoRoot(".")
		if err != nil {
			fmt.Fprintf(os.Stderr, "ciguard: %v\n", err)
			os.Exit(2)
		}
		repoRoot = found
	}

	guards := []guard{
		{name: "lean-checkout", run: ciguard.LeanCheckout},
	}

	if failed := runAll(guards, repoRoot); failed {
		fmt.Fprintln(os.Stderr, "\nSee specs/ci/lean-checkout.feature")
		os.Exit(1)
	}
}

// runAll reports every guard rather than stopping at the first, so one run
// tells you everything that needs fixing.
func runAll(guards []guard, repoRoot string) bool {
	failed := false
	for _, g := range guards {
		problems, err := g.run(repoRoot)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ciguard: %s: %v\n", g.name, err)
			os.Exit(2)
		}
		if len(problems) == 0 {
			fmt.Printf("✓ %s\n", g.name)

			continue
		}

		failed = true
		fmt.Fprintf(os.Stderr, "✗ %s\n", g.name)
		for _, problem := range problems {
			fmt.Fprintf(os.Stderr, "    %s\n", problem)
		}
	}

	return failed
}
