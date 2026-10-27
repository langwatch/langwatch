package gowatch

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func writeUnder(t *testing.T, root, rel, body string) {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func watchEvents(t *testing.T, tree *Tree) *Events {
	t.Helper()
	ev, err := tree.WatchEvents(func(msg string) { t.Log(msg) })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ev.Close)
	return ev
}

// woke reports whether a wake arrives within d, then drains the burst's echoes.
func woke(ev *Events, d time.Duration) bool {
	select {
	case <-ev.wake:
	case <-time.After(d):
		return false
	}
	time.Sleep(50 * time.Millisecond)
	select {
	case <-ev.wake:
	default:
	}
	return true
}

// @scenario "A Go edit burst rebuilds the combined child once, after the quiet window"
func TestEventsWakeOnEditsNewFilesNestedDirsAndRemovals(t *testing.T) {
	root := t.TempDir()
	writeUnder(t, root, "src/a.go", "package a\n")
	tree := PathsTree(root, "go.mod", "src")
	last := tree.Fingerprint()
	ev := watchEvents(t, tree)
	steps := []struct {
		name   string
		change func()
	}{
		{"an edit in place", func() { writeUnder(t, root, "src/a.go", "package a // edited\n") }},
		{"a new file in a known directory", func() { writeUnder(t, root, "src/b.go", "package a\n") }},
		{"a new nested directory", func() { writeUnder(t, root, "src/deep/c.go", "package deep\n") }},
		{"an edit inside the nested directory", func() { writeUnder(t, root, "src/deep/c.go", "package deep // edited\n") }},
		{"a new top-level file", func() { writeUnder(t, root, "go.mod", "module x\n") }},
		{"a removed file", func() {
			if err := os.Remove(filepath.Join(root, "src", "b.go")); err != nil {
				t.Fatal(err)
			}
		}},
		{"a removed directory", func() {
			if err := os.RemoveAll(filepath.Join(root, "src", "deep")); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, step := range steps {
		step.change()
		if !woke(ev, 2*time.Second) {
			t.Fatalf("%s raised no file event", step.name)
		}
		fp := tree.Fingerprint()
		if fp == last {
			t.Errorf("%s woke the loop but did not change the fingerprint", step.name)
		}
		last = fp
	}
	if ev.WatchCount() != 1 {
		t.Errorf("watching %d directories after the nested one went, want 1", ev.WatchCount())
	}
}

func TestEventsIgnoreTestsSkippedDirsAndOtherFiles(t *testing.T) {
	root := t.TempDir()
	writeUnder(t, root, "src/a.go", "package a\n")
	writeUnder(t, root, "src/node_modules/x/y.go", "package y\n")
	writeUnder(t, root, "README.md", "hi\n")
	ev := watchEvents(t, PathsTree(root, "go.mod", "src"))
	writeUnder(t, root, "src/a_test.go", "package a\n")
	writeUnder(t, root, "src/notes.md", "hi\n")
	writeUnder(t, root, "src/node_modules/x/y.go", "package y // edited\n")
	writeUnder(t, root, "src/.cache/z.go", "package z\n")
	writeUnder(t, root, "README.md", "edited\n")
	if woke(ev, 500*time.Millisecond) {
		t.Error("a test, a doc, a skipped or hidden directory or a file beside a watched one woke the loop")
	}
}

// @scenario "A Go edit burst rebuilds the combined child once, after the quiet window"
func TestLoopRebuildsABurstOfSavesOnceFromFileEvents(t *testing.T) {
	root := t.TempDir()
	writeUnder(t, root, "src/a.go", "package a\n")
	tree := PathsTree(root, "src")
	clock := &Clock{Quiet: 200 * time.Millisecond, MaxWait: time.Minute}
	last := tree.Fingerprint()
	var rebuilds atomic.Int32
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		// Poll and Safety are an hour: only file events and the clock can drive it.
		loop := Loop{Tree: tree, Clock: clock, Poll: time.Hour, Safety: time.Hour, Log: func(string) {}}
		loop.Run(ctx, func(now time.Time) bool {
			if fp := tree.Fingerprint(); fp != last {
				last = fp
				clock.Change(now)
			}
			if clock.Due(now) {
				clock.Reset()
				rebuilds.Add(1)
			}
			return false
		})
	}()
	time.Sleep(100 * time.Millisecond) // the loop's watches are in place
	for i := range 5 {
		writeUnder(t, root, "src/a.go", "package a // save "+string(rune('0'+i))+"\n")
		time.Sleep(30 * time.Millisecond)
	}
	deadline := time.Now().Add(3 * time.Second)
	for rebuilds.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(400 * time.Millisecond)
	cancel()
	<-done
	if got := rebuilds.Load(); got != 1 {
		t.Errorf("a burst of 5 saves rebuilt %d times, want 1", got)
	}
}

// A due burst held back (ui-watch waits for the first bundle) retries every Poll, never spinning.
func TestLoopRetriesAHeldBackBurstEveryPoll(t *testing.T) {
	root := t.TempDir()
	writeUnder(t, root, "src/a.go", "package a\n")
	tree := PathsTree(root, "src")
	clock := &Clock{Quiet: time.Millisecond, MaxWait: time.Minute}
	last := tree.Fingerprint()
	var wakes, rebuilds atomic.Int32
	opened := time.Now().Add(400 * time.Millisecond)
	ctx, cancel := context.WithTimeout(t.Context(), 700*time.Millisecond)
	defer cancel()
	go func() {
		time.Sleep(100 * time.Millisecond)
		_ = os.WriteFile(filepath.Join(root, "src", "a.go"), []byte("package a // edited\n"), 0o600)
	}()
	loop := Loop{Tree: tree, Clock: clock, Poll: 50 * time.Millisecond, Safety: time.Hour, Log: func(string) {}}
	loop.Run(ctx, func(now time.Time) bool {
		wakes.Add(1)
		if fp := tree.Fingerprint(); fp != last {
			last = fp
			clock.Change(now)
		}
		if now.Before(opened) || !clock.Due(now) {
			return false
		}
		clock.Reset()
		rebuilds.Add(1)
		return false
	})
	if wakes.Load() > 20 {
		t.Errorf("the held-back burst woke the loop %d times in 700ms, want about one per Poll", wakes.Load())
	}
	if rebuilds.Load() != 1 {
		t.Errorf("rebuilt %d times once the gate opened, want 1", rebuilds.Load())
	}
}
