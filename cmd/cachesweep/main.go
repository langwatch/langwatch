// Command cachesweep deletes main's superseded copies of the Actions caches
// keyed by the commit, keeping the newest of each. A failed listing fails the
// command; a failed delete only warns.
//
// Usage (gh on PATH, GH_TOKEN and GH_REPO set):
//
//	go run ./cmd/cachesweep
//
// Spec: specs/ci/main-cache-sweep.feature
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"

	"github.com/langwatch/langwatch/tools/cachesweep"
)

// no-test: a thin wrapper over gh; tools/cachesweep tests the selection.
func main() {
	ctx := context.Background()
	out, err := exec.CommandContext(ctx, "gh", "cache", "list", "--ref", "refs/heads/main",
		"--limit", "1000", "--sort", "created_at", "--order", "desc", "--json", "id,key,createdAt").Output()
	if err != nil {
		fmt.Fprintf(os.Stderr, "::error::Could not list main's caches: %v\n", err)
		os.Exit(1)
	}
	var entries []cachesweep.Entry
	if err := json.Unmarshal(out, &entries); err != nil {
		fmt.Fprintf(os.Stderr, "::error::Could not read gh's cache list: %v\n", err)
		os.Exit(1)
	}

	redundant := cachesweep.Superseded(entries)
	for _, entry := range redundant {
		cmd := exec.CommandContext(ctx, "gh", "cache", "delete", strconv.FormatInt(entry.ID, 10)) //nolint:gosec // G204: integer id from gh's own listing
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			fmt.Printf("::warning::Could not delete cache %d (%s); continuing.\n", entry.ID, entry.Key)
		}
	}
	fmt.Printf("Deleted %d superseded cache copies on main.\n", len(redundant))
}
