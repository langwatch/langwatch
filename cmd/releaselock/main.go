// Command releaselock asserts the Python SDK release keeps uv.lock in step.
//
// Usage:
//
//	go run ./cmd/releaselock            # from anywhere in the tree
//	go run ./cmd/releaselock -root .    # explicit root
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/releaselock"
)

func main() {
	root := flag.String("root", "", "repository root (default: nearest ancestor holding go.work)")
	flag.Parse()

	repoRoot := *root
	if repoRoot == "" {
		found, err := ciscan.RepoRoot(".")
		if err != nil {
			fmt.Fprintf(os.Stderr, "releaselock: %v\n", err)
			os.Exit(2)
		}
		repoRoot = found
	}

	problems, err := releaselock.Check(repoRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "releaselock: %v\n", err)
		os.Exit(2)
	}
	for _, problem := range problems {
		fmt.Fprintf(os.Stderr, "✗ %s\n", problem)
	}
	if len(problems) > 0 {
		os.Exit(1)
	}
	fmt.Println("✓ uv.lock follows the Python SDK release")
}
