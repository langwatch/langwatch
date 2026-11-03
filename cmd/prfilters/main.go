// Command prfilters writes .github/pr-filters.yml, pr.yml's path filter: a
// key per product check it calls, holding every path that check's own
// detect-changes steps consult, so the two never drift.
// Spec: specs/ci/one-pull-request-workflow.feature
//
// Usage:
//
//	go run ./cmd/prfilters
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ciguard"
)

func main() {
	root, err := ciscan.RepoRoot(".")
	if err == nil {
		var content string
		if content, err = ciguard.PRFilters(root); err == nil {
			err = os.WriteFile(filepath.Join(root, ciguard.PRFiltersFile), []byte(content), 0o644) //nolint:gosec // G306: a checked-in file everyone reads
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "prfilters: %v\n", err)
		os.Exit(1)
	}
}
