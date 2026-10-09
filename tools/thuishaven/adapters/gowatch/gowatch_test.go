package gowatch

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// @scenario "A Go edit burst rebuilds the combined child once, after the quiet window"
func TestClockWaitsOutTheQuietWindow(t *testing.T) {
	at := time.Unix(0, 0)
	c := Clock{Quiet: 2 * time.Second, MaxWait: 30 * time.Second}
	if c.Due(at) {
		t.Fatal("due with no change")
	}
	c.Change(at)
	c.Change(at.Add(1500 * time.Millisecond))
	if c.Due(at.Add(3 * time.Second)) {
		t.Fatal("due before the quiet window since the last change passed")
	}
	if !c.Due(at.Add(3500 * time.Millisecond)) {
		t.Fatal("not due after the quiet window")
	}
	c.Reset()
	if c.Due(at.Add(time.Hour)) {
		t.Fatal("due again after reset with no new change")
	}
}

// @scenario "A steady trickle of Go edits still rebuilds within the max wait"
func TestClockMaxWaitBoundsATrickle(t *testing.T) {
	at := time.Unix(0, 0)
	c := Clock{Quiet: 2 * time.Second, MaxWait: 30 * time.Second}
	for s := 0; s < 30; s++ {
		c.Change(at.Add(time.Duration(s) * time.Second))
		if c.Due(at.Add(time.Duration(s) * time.Second)) {
			t.Fatalf("due at %ds, inside both windows", s)
		}
	}
	if !c.Due(at.Add(30 * time.Second)) {
		t.Fatal("trickle never rebuilt within the max wait")
	}
}

func TestFingerprintIgnoresTestsAndNodeModules(t *testing.T) {
	repo := t.TempDir()
	write := func(rel string) {
		path := filepath.Join(repo, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(rel+time.Now().String()), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("pkg/a/a.go")
	before := Fingerprint(repo)
	write("pkg/a/a_test.go")
	write("services/x/node_modules/y/z.go")
	write("services/x/web/dist/app.js")
	if Fingerprint(repo) != before {
		t.Fatal("a test file, node_modules or a dist changed the fingerprint")
	}
	write("services/x/x.go")
	if Fingerprint(repo) == before {
		t.Fatal("a new source file did not change the fingerprint")
	}
}

func sleeper(ctx context.Context) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, "sleep", "60")
	err := cmd.Start()
	return cmd, err
}

// @scenario "A failed Go build keeps the running child"
func TestFailedBuildKeepsTheRunningChild(t *testing.T) {
	isBroken := false
	s := &Swapper{
		Build: func(context.Context) error {
			if isBroken {
				return errors.New("compile error")
			}
			return nil
		},
		Start: sleeper, Grace: time.Second, Log: func(string) {},
	}
	defer s.Stop()
	if err := s.Rebuild(t.Context()); err != nil {
		t.Fatal(err)
	}
	first := s.Pid()
	isBroken = true
	if err := s.Rebuild(t.Context()); err == nil {
		t.Fatal("a failed build reported success")
	}
	if s.Pid() != first {
		t.Fatalf("failed build replaced the child: %d -> %d", first, s.Pid())
	}
	isBroken = false
	if err := s.Rebuild(t.Context()); err != nil {
		t.Fatal(err)
	}
	if s.Pid() == first || s.Pid() == 0 {
		t.Fatal("a good build did not swap in a new child")
	}
}

func TestFingerprintPathsSeesAWatchedFileAndATreeButNotATest(t *testing.T) {
	root := t.TempDir()
	write := func(rel, body string) {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("go.mod", "module x\n")
	write("src/a.go", "package a\n")
	before := FingerprintPaths(root, "go.mod", "src", "missing")
	write("src/a_test.go", "package a\n")
	if FingerprintPaths(root, "go.mod", "src", "missing") != before {
		t.Error("a test file changed the fingerprint")
	}
	write("go.mod", "module x // edited\n")
	if FingerprintPaths(root, "go.mod", "src", "missing") == before {
		t.Error("an edited go.mod did not change the fingerprint")
	}
}
