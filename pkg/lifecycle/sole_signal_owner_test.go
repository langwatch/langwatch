package lifecycle

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// pkg/lifecycle is the ONLY place a deployed Go service may register a
// termination-signal handler.
//
// Go runs every listener registered for a signal, so a second one does not
// layer politely on top of the first — the two race, and whichever finishes
// first decides when the process dies, cutting the other's drain short with no
// error and no log line saying so. pkg/config used to carry exactly that: a
// `ListenAndServe` with its own signal.Notify that closed the HTTP server and
// nothing else, no draining flip and no drain delay. It had no callers, so
// nothing was broken; it was removed because the first person to reach for it
// would have been.
//
// Non-termination signals are a different subject and are allowed: langyagent's
// orphan reaper listens for SIGCHLD because only PID 1 may reap the children
// opencode leaves behind, which has nothing to do with shutdown.
//
// @scenario "Only pkg/lifecycle registers a termination-signal handler"
func TestOnlyLifecycleRegistersTerminationSignals(t *testing.T) {
	root := repoRoot(t)

	// Deployed Go code only. tools/ is developer CLI (haven), and cmd/ holds
	// thin main() entrypoints; neither runs in a pod.
	scanRoots := []string{"services", "pkg"}

	notify := regexp.MustCompile(`signal\.(Notify|NotifyContext)\(`)
	terminationSignal := regexp.MustCompile(`SIGTERM|SIGINT|os\.Interrupt`)

	allowed := map[string]bool{
		filepath.Join("pkg", "lifecycle", "group.go"): true,
	}

	// Paths are collected first and read afterwards. Reading inside the walk
	// callback trips gosec's G122 (the path a callback receives can change under
	// it), and the scan does not need to be a single pass.
	var candidates []string

	for _, scanRoot := range scanRoots {
		err := filepath.WalkDir(filepath.Join(root, scanRoot), func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			rel, relErr := filepath.Rel(root, path)
			if relErr != nil {
				return relErr
			}
			if allowed[rel] {
				return nil
			}
			candidates = append(candidates, rel)
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", scanRoot, err)
		}
	}

	var offenders []string
	for _, rel := range candidates {
		body, readErr := os.ReadFile(filepath.Join(root, rel))
		if readErr != nil {
			t.Fatalf("read %s: %v", rel, readErr)
		}
		for i, line := range strings.Split(string(body), "\n") {
			if notify.MatchString(line) && terminationSignal.MatchString(line) {
				offenders = append(offenders, rel+":"+itoa(i+1))
			}
		}
	}

	if len(offenders) > 0 {
		t.Errorf(
			"termination-signal handlers registered outside pkg/lifecycle:\n  %s\n\n"+
				"Go runs every listener for a signal, so these race pkg/lifecycle's shutdown "+
				"and whichever finishes first ends the process. Register the work as a "+
				"lifecycle.Service instead.",
			strings.Join(offenders, "\n  "),
		)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

// repoRoot walks up from the test's working directory to the module root.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not find go.mod above the test's working directory")
		}
		dir = parent
	}
}
