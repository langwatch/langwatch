// Command suiteweights rewrites .github/package-suites.weights from the job
// logs of the newest main runs whose package-suites shards all passed, so the
// shard split is refreshed by a command instead of by pasting job summaries.
// It needs an authenticated `gh`.
// Spec: specs/ci/package-suites-weights.feature
//
// Usage:
//
//	go run ./cmd/suiteweights             # the newest 3 green runs
//	go run ./cmd/suiteweights -runs 5
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/suiteweights"
)

func main() {
	runs := flag.Int("runs", 3, "how many green main runs to take the median over")
	repo := flag.String("repo", "langwatch/langwatch", "the GitHub repository")
	workflow := flag.String("workflow", "langwatch-app-ci.yml", "the workflow holding the package-suites job")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	err := run(*runs, suiteweights.GitHub{Ctx: ctx, Repo: *repo, Workflow: *workflow})
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "suiteweights: %v\n", err)
		os.Exit(1)
	}
}

func run(runs int, src suiteweights.Source) error {
	root, err := ciscan.RepoRoot(".")
	if err != nil {
		return err
	}
	ids, measured, err := suiteweights.Collect(src, runs)
	if err != nil {
		return err
	}
	path := filepath.Join(root, ".github", "package-suites.weights")
	// Absent on a first run; then every package is weighed from the runs alone.
	committed, _ := os.ReadFile(path)
	previous := suiteweights.ParseWeights(string(committed))
	content := suiteweights.Render(suiteweights.Weigh(measured, previous), ids)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil { //nolint:gosec // G306: a checked-in file everyone reads
		return err
	}
	fmt.Printf("wrote %s from runs %v\n", path, ids)
	return nil
}
