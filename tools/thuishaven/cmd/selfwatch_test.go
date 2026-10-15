package cmd

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/gowatch"
)

// testSelfWatch watches a temp checkout with one source file and a fake binary.
func testSelfWatch(t *testing.T, build func(out string) error) (*selfWatch, *int) {
	t.Helper()
	root := t.TempDir()
	src := filepath.Join(root, "tools", "thuishaven", "a.go")
	if err := os.MkdirAll(filepath.Dir(src), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("package a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(root, "haven")
	if err := os.WriteFile(exe, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	handOvers := 0
	w := &selfWatch{
		root:     root,
		exe:      exe,
		clock:    &gowatch.Clock{Quiet: time.Second, MaxWait: time.Minute},
		build:    func(_ context.Context, out string) error { return build(out) },
		handOver: func() error { handOvers++; return nil },
		log:      func(string) {},
	}
	w.last = gowatch.FingerprintPaths(root, selfWatchedPaths...)
	if err := os.WriteFile(src, []byte("package a // edited\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return w, &handOvers
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestSelfWatchAGoodBuildReplacesTheBinaryAndHandsOver(t *testing.T) {
	w, handOvers := testSelfWatch(t, func(out string) error { return os.WriteFile(out, []byte("new"), 0o600) })
	at := time.Unix(0, 0)
	if w.observe(t.Context(), at) {
		t.Fatal("handed over before the quiet window passed")
	}
	if !w.observe(t.Context(), at.Add(2*time.Second)) {
		t.Fatal("no hand-over after the quiet window")
	}
	if got := readFile(t, w.exe); got != "new" || *handOvers != 1 {
		t.Errorf("binary %q, hand-overs %d; want the new build in place and one successor", got, *handOvers)
	}
	if _, err := os.Stat(w.exe + ".next"); !os.IsNotExist(err) {
		t.Error("the temp build was left beside the binary")
	}
}

func TestSelfWatchAFailedBuildKeepsTheDaemonAndItsBinary(t *testing.T) {
	w, handOvers := testSelfWatch(t, func(out string) error {
		_ = os.WriteFile(out, []byte("half"), 0o600)
		return errors.New("compile error")
	})
	at := time.Unix(0, 0)
	w.observe(t.Context(), at)
	if w.observe(t.Context(), at.Add(2*time.Second)) {
		t.Fatal("a failed build handed over")
	}
	if got := readFile(t, w.exe); got != "old" || *handOvers != 0 {
		t.Errorf("binary %q, hand-overs %d; want the old binary and no successor", got, *handOvers)
	}
	if _, err := os.Stat(w.exe + ".next"); !os.IsNotExist(err) {
		t.Error("the failed build's output was left beside the binary")
	}
}

func TestSelfWatchIsOffWhenTheGoWatchSwitchIsOff(t *testing.T) {
	t.Setenv("LANGWATCH_GO_WATCH", "0")
	if newSelfWatch(func() error { return nil }) != nil {
		t.Error("LANGWATCH_GO_WATCH=0 must turn the daemon's self-watch off (D5)")
	}
}
