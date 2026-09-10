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

	out, err := exec.Command("make", "-C", repoRoot, "-n", "go-lint").CombinedOutput()
	if err != nil {
		t.Fatalf("make -n go-lint: %v\n%s", err, out)
	}
	got := string(out)
	if !strings.Contains(got, "slot run") {
		t.Fatalf("`make go-lint` must route golangci-lint through `haven slot run` so it queues against the same machine-wide counter as a typecheck, got:\n%s", got)
	}
	if !strings.Contains(got, "golangci-lint") {
		t.Fatalf("`make go-lint` must still run golangci-lint itself, got:\n%s", got)
	}
}
