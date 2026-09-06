package main

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/linkcheck"
)

// These cover the verdict-to-exit-code step, which is the only part of the
// tool CI actually gates on. Everything below it is asserted in
// tools/linkcheck; without these, gating on Unverified — or not gating at
// all — would keep the whole suite green.

// @scenario "A markdown link to a page that is gone fails the check"
func TestReportFailsOnADeadLink(t *testing.T) {
	failed := report("README.md", []linkcheck.Result{
		{Link: linkcheck.Link{Target: "https://langwatch.ai/gone", Line: 3}, Status: http.StatusNotFound, Verdict: linkcheck.Dead},
	})

	if !failed {
		t.Error("got failed=false for a dead link, want true")
	}
}

// @scenario "A bot-blocked host does not fail the check"
func TestReportPassesOnAnUnverifiedLink(t *testing.T) {
	failed := report("README.md", []linkcheck.Result{
		{Link: linkcheck.Link{Target: "https://www.npmjs.com/package/langwatch", Line: 11}, Status: http.StatusForbidden, Verdict: linkcheck.Unverified},
	})

	if failed {
		t.Error("got failed=true for an unverified link, want false — a bot block must not gate")
	}
}

func TestReportPassesWhenEveryLinkResolves(t *testing.T) {
	failed := report("README.md", []linkcheck.Result{
		{Link: linkcheck.Link{Target: "https://langwatch.ai", Line: 1}, Status: http.StatusOK, Verdict: linkcheck.OK},
	})

	if failed {
		t.Error("got failed=true with no dead links, want false")
	}
}

// A dead link alongside an unverified one still fails: the unverified result
// must not mask the finding, nor rescue the run.
func TestReportFailsWhenADeadLinkAccompaniesAnUnverifiedOne(t *testing.T) {
	failed := report("README.md", []linkcheck.Result{
		{Link: linkcheck.Link{Target: "https://www.npmjs.com/package/langwatch", Line: 11}, Status: http.StatusForbidden, Verdict: linkcheck.Unverified},
		{Link: linkcheck.Link{Target: "https://langwatch.ai/gone", Line: 12}, Status: http.StatusNotFound, Verdict: linkcheck.Dead},
	})

	if !failed {
		t.Error("got failed=false, want true — an unverified link must not rescue a dead one")
	}
}

// @scenario "A relative link to a path that no longer exists fails the check"
func TestRunFailsOnADocumentWithADeadRepositoryPath(t *testing.T) {
	root := t.TempDir()
	readme := filepath.Join(root, "README.md")
	if err := os.WriteFile(readme, []byte("[gone](/does-not-exist.md)\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	failed, err := run(t.Context(), linkcheck.Checker{RepoRoot: root}, []document{{name: "README.md", path: readme}})

	if err != nil {
		t.Fatalf("got error %v, want none", err)
	}
	if !failed {
		t.Error("got failed=false, want true")
	}
}

func TestRunPassesOnADocumentWhoseRepositoryPathsResolve(t *testing.T) {
	root := t.TempDir()
	readme := filepath.Join(root, "README.md")
	if err := os.WriteFile(readme, []byte("[license](/LICENSE.md)\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "LICENSE.md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	failed, err := run(t.Context(), linkcheck.Checker{RepoRoot: root}, []document{{name: "README.md", path: readme}})

	if err != nil {
		t.Fatalf("got error %v, want none", err)
	}
	if failed {
		t.Error("got failed=true, want false")
	}
}

// An unreadable document is a run that could not happen, not a run that
// found a dead link — main turns this into exit 2 rather than exit 1.
func TestRunReturnsAnErrorForAnUnreadableDocument(t *testing.T) {
	root := t.TempDir()

	_, err := run(context.Background(), linkcheck.Checker{RepoRoot: root},
		[]document{{name: "missing.md", path: filepath.Join(root, "missing.md")}})

	if err == nil {
		t.Error("got no error for an unreadable document, want one")
	}
}
