// Command operatornotes adds an "Operator action required" section to a
// published release's notes, listing the pull requests it ships that carry the
// operator-action label. A release with none is left as it is.
//
// Usage (gh on PATH, GH_TOKEN set):
//
//	go run ./cmd/operatornotes -repo langwatch/langwatch -tag langwatch@v3.22.0 [-print]
//
// Spec: specs/ci/deployment-impact-report.feature
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/deployimpact"
	"github.com/langwatch/langwatch/tools/operatornotes"
)

// no-test: a thin wrapper over gh; tools/operatornotes tests the section.
func main() {
	repo := flag.String("repo", "", "the GitHub repository, owner/name")
	tag := flag.String("tag", "", "the published release's tag")
	printOnly := flag.Bool("print", false, "print the notes instead of editing the release")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	err := run(ctx, release{repo: *repo, tag: *tag, printOnly: *printOnly})
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "::error::operatornotes: %v\n", err)
		os.Exit(1)
	}
}

type release struct {
	repo, tag string
	printOnly bool
}

func run(ctx context.Context, target release) error {
	repo, tag := target.repo, target.tag
	if repo == "" || tag == "" {
		return fmt.Errorf("-repo and -tag are required")
	}
	notes, err := gh(ctx, "release", "view", tag, "--repo", repo, "--json", "body", "--jq", ".body")
	if err != nil {
		return err
	}
	listing, err := gh(ctx, "api", "--paginate", "--slurp",
		fmt.Sprintf("repos/%s/issues?labels=%s&state=closed&per_page=100", repo, deployimpact.Label))
	if err != nil {
		return err
	}
	var pages [][]operatornotes.PullRequest
	if err := json.Unmarshal([]byte(listing), &pages); err != nil {
		return fmt.Errorf("reading the pull request carrying the labels: %w", err)
	}
	var marked []operatornotes.PullRequest
	for _, page := range pages {
		marked = append(marked, page...)
	}
	updated := operatornotes.WithSection(notes, operatornotes.Shipped(notes, marked))
	if target.printOnly {
		fmt.Println(updated)
		return nil
	}
	if strings.TrimSpace(updated) == strings.TrimSpace(notes) {
		fmt.Println("no pull request carrying the label in this release; notes unchanged")
		return nil
	}
	file := filepath.Join(os.TempDir(), "operator-notes.md")
	if err := os.WriteFile(file, []byte(updated), 0o600); err != nil {
		return err
	}
	_, err = gh(ctx, "release", "edit", tag, "--repo", repo, "--notes-file", file)
	return err
}

func gh(ctx context.Context, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, "gh", args...).Output()
	if exit, ok := errors.AsType[*exec.ExitError](err); ok {
		return "", fmt.Errorf("gh %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(exit.Stderr)))
	}
	return strings.TrimRight(string(out), "\n"), err
}
