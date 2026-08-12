// Command linkcheck resolves the links in the repository's markdown, so a
// page that gets renamed on the docs site fails here rather than under a
// first-time reader.
//
// Only 404 and 410 fail the run. Everything else a host can answer — a bot
// block, a rate limit, a timeout — is reported as unverified and does not
// gate, because a check that fails on npmjs.com answering 403 to a datacenter
// address is a check that gets ignored.
//
// Usage:
//
//	go run ./cmd/linkcheck                  # README.md
//	go run ./cmd/linkcheck docs/README.md   # explicit files
//	go run ./cmd/linkcheck -offline         # repository paths only, no network
//
// Spec: specs/ci/readme-link-check.feature
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/linkcheck"
)

func main() {
	root := flag.String("root", "", "repository root (default: nearest ancestor holding go.work)")
	offline := flag.Bool("offline", false, "check repository paths only, never the network")
	timeout := flag.Duration("timeout", 20*time.Second, "per-request timeout")
	flag.Parse()

	repoRoot := *root
	if repoRoot == "" {
		found, err := ciscan.RepoRoot(".")
		if err != nil {
			fmt.Fprintf(os.Stderr, "linkcheck: %v\n", err)
			os.Exit(2)
		}
		repoRoot = found
	}

	names := flag.Args()
	if len(names) == 0 {
		names = []string{"README.md"}
	}

	documents := make([]document, 0, len(names))
	for _, name := range names {
		path := name
		if !filepath.IsAbs(path) {
			path = filepath.Join(repoRoot, name)
		}
		documents = append(documents, document{name: name, path: path})
	}

	checker := linkcheck.Checker{RepoRoot: repoRoot}
	if !*offline {
		checker.Fetch = linkcheck.HTTPFetcher(*timeout)
	}

	failed, err := run(context.Background(), checker, documents)
	if err != nil {
		fmt.Fprintf(os.Stderr, "linkcheck: %v\n", err)
		os.Exit(2)
	}
	if failed {
		fmt.Fprintln(os.Stderr, "\nSee specs/ci/readme-link-check.feature")
		os.Exit(1)
	}
}

// document is one file to check: the path to read, and the name to print,
// which is what the caller typed.
type document struct {
	name string
	path string
}

// run checks every document before reporting, so one run tells you every dead
// link rather than the first one.
func run(ctx context.Context, checker linkcheck.Checker, documents []document) (bool, error) {
	failed := false

	for _, doc := range documents {
		content, err := os.ReadFile(doc.path)
		if err != nil {
			return false, err
		}

		if report(doc.name, checker.Run(ctx, doc.path, string(content))) {
			failed = true
		}
	}
	return failed, nil
}

// report prints one document's outcome and says whether it failed. Dead links
// go to stderr; the unverified ones are a note, not a finding.
func report(document string, results []linkcheck.Result) bool {
	var dead, unverified []linkcheck.Result
	for _, result := range results {
		switch result.Verdict {
		case linkcheck.Dead:
			dead = append(dead, result)
		case linkcheck.Unverified:
			unverified = append(unverified, result)
		case linkcheck.OK:
		}
	}

	if len(dead) == 0 {
		fmt.Printf("✓ %s\n", document)
	} else {
		fmt.Printf("✗ %s\n", document)
	}
	for _, result := range dead {
		fmt.Fprintf(os.Stderr, "    %s:%d %s\n", document, result.Line, describe(result))
	}
	for _, result := range unverified {
		fmt.Printf("    unverified: %s:%d %s\n", document, result.Line, describe(result))
	}

	return len(dead) > 0
}

func describe(result linkcheck.Result) string {
	switch {
	case result.Detail != "" && result.Status != 0:
		return fmt.Sprintf("%s (%d, %s)", result.Target, result.Status, result.Detail)
	case result.Detail != "":
		return fmt.Sprintf("%s (%s)", result.Target, result.Detail)
	default:
		return fmt.Sprintf("%s (%d)", result.Target, result.Status)
	}
}
