package cmd

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// @scenario "With haven installed the queue runs inside haven"
func TestGoLintRoutesThroughHavenSlotRun(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not resolve this test file's own path")
	}
	// tools/thuishaven/cmd -> tools/thuishaven -> tools -> repo root.
	repoRoot := filepath.Join(filepath.Dir(file), "..", "..", "..")

	for _, target := range []string{"go-lint", "go-lint-changed"} {
		out, err := exec.Command("make", "-C", repoRoot, "-n", target).CombinedOutput()
		if err != nil {
			t.Fatalf("make -n %s: %v\n%s", target, err, out)
		}
		got := string(out)
		if !strings.Contains(got, "slot run") {
			t.Fatalf("`make %s` must route golangci-lint through `haven slot run` so it queues against the same machine-wide counter as a typecheck, got:\n%s", target, got)
		}
		if !strings.Contains(got, "golangci-lint") {
			t.Fatalf("`make %s` must still run golangci-lint itself, got:\n%s", target, got)
		}
	}
}
