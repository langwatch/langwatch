// Package gowatch is haven's Go hot reload for a stack's combined child: it
// watches the Go trees, waits out a quiet window, rebuilds the one binary and
// swaps the running child for the new one (HAVEN-SWAP: stop old, start new).
// A failed build keeps the old child serving. It replaces air.
package gowatch

import (
	"context"
	"encoding/binary"
	"fmt"
	"hash"
	"hash/fnv"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Clock is the debounce: a change is due once Quiet has passed since the last
// change, or MaxWait since the first, so a steady trickle of agent edits still
// rebuilds. Changes seen after Reset (during a build) start the next burst.
type Clock struct {
	Quiet, MaxWait time.Duration
	first, last    time.Time
	isDirty        bool
}

// Change records one observed change.
func (c *Clock) Change(now time.Time) {
	if !c.isDirty {
		c.first = now
	}
	c.isDirty, c.last = true, now
}

// Due reports whether the pending burst should rebuild now.
func (c *Clock) Due(now time.Time) bool {
	return c.isDirty && (now.Sub(c.last) >= c.Quiet || now.Sub(c.first) >= c.MaxWait)
}

// Reset clears the pending burst; call it as the rebuild starts.
func (c *Clock) Reset() { c.isDirty = false }

// DueAt is when the pending burst falls due; zero when nothing is pending.
func (c *Clock) DueAt() time.Time {
	if !c.isDirty {
		return time.Time{}
	}
	at := c.last.Add(c.Quiet)
	if limit := c.first.Add(c.MaxWait); limit.Before(at) {
		at = limit
	}
	return at
}

// watchedDirs are the Go trees `./cmd/service` builds from.
var watchedDirs = []string{"cmd", "pkg", "services"}

// skippedDirs never hold source the binary is built from.
var skippedDirs = map[string]bool{"node_modules": true, "dist": true, ".bin": true, "vendor": true, "testdata": true}

// Fingerprint hashes every watched file's path, size and mtime. Tests never
// change the binary, and a mass test write is the common AI burst, so
// `_test.go` is not watched.
func Fingerprint(repoRoot string) uint64 { return GoTree(repoRoot).Fingerprint() }

// GoTree is Fingerprint's tree, kept across polls.
func GoTree(repoRoot string) *Tree {
	return PathsTree(repoRoot, append([]string{"go.work"}, watchedDirs...)...)
}

// FingerprintPaths is Fingerprint over the given files and trees under root.
func FingerprintPaths(root string, paths ...string) uint64 {
	return PathsTree(root, paths...).Fingerprint()
}

// PathsTree is FingerprintPaths's tree, kept across polls.
func PathsTree(root string, paths ...string) *Tree {
	return &Tree{root: root, paths: paths, isWatched: isWatchedFile, skipped: skippedDirs}
}

// uiWatchedDirs hold the source `vite build` bundles; a dir named `process` is
// a module's backend half, never in the bundle.
var uiWatchedDirs = []string{"apps/ui", "modules", "enterprise/modules", "packages"}

var uiSkippedDirs = map[string]bool{
	"node_modules": true, "dist": true, "__tests__": true, "process": true,
	// Docs and build output: a Storybook build's JSON would otherwise read as a UI edit.
	"specs": true, "adrs": true, "storybook-static": true, "coverage": true,
}

// UIFingerprint hashes the browser source the built UI is bundled from.
func UIFingerprint(repoRoot string) uint64 { return UITree(repoRoot).Fingerprint() }

// UITree is UIFingerprint's tree, kept across polls.
func UITree(repoRoot string) *Tree {
	return &Tree{root: repoRoot, paths: uiWatchedDirs, isWatched: isUIFile, skipped: uiSkippedDirs}
}

func isUIFile(name string) bool {
	if strings.HasSuffix(name, ".test.ts") || strings.HasSuffix(name, ".test.tsx") {
		return false
	}
	switch filepath.Ext(name) {
	case ".ts", ".tsx", ".css", ".json", ".svg":
		return true
	}
	return false
}

// Tree is a watched set of files and trees that remembers each directory's
// listing: a directory whose mtime has not moved has the same entries, so a
// poll stats it instead of reopening and rereading it. Watched files are
// still statted every poll, which is what sees an edit in place.
type Tree struct {
	root      string
	paths     []string
	isWatched func(string) bool
	skipped   map[string]bool
	listings  map[string]listing
	next      map[string]listing // the listings this poll saw, kept for the next
}

// listing is one directory's watched files and descended subdirectories, as full paths.
type listing struct {
	mtime   int64
	files   []string
	subdirs []string
}

// Fingerprint hashes every watched file's path, size and mtime.
func (t *Tree) Fingerprint() uint64 {
	h := fnv.New64a()
	t.next = make(map[string]listing, len(t.listings))
	for _, p := range t.paths {
		top := filepath.Join(t.root, p)
		info, err := os.Lstat(top)
		switch {
		case err != nil:
		case info.IsDir():
			t.walk(h, top, info)
		case t.isWatched(info.Name()):
			stampFile(h, top, info)
		}
	}
	t.listings, t.next = t.next, nil
	return h.Sum64()
}

// walk hashes one directory's watched files and descends into its subdirectories.
func (t *Tree) walk(h hash.Hash64, dir string, info fs.FileInfo) {
	l, ok := t.listingFor(dir, info)
	if !ok {
		return // an unreadable directory ends that directory's walk
	}
	t.next[dir] = l
	for _, path := range l.files {
		if fi, err := os.Lstat(path); err == nil {
			stampFile(h, path, fi)
		}
	}
	for _, path := range l.subdirs {
		if fi, err := os.Lstat(path); err == nil && fi.IsDir() {
			t.walk(h, path, fi)
		}
	}
}

// listingFor is the kept listing while the directory's mtime holds, else a fresh read.
func (t *Tree) listingFor(dir string, info fs.FileInfo) (listing, bool) {
	mtime := info.ModTime().UnixNano()
	if l, ok := t.listings[dir]; ok && l.mtime == mtime {
		return l, true
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return listing{}, false
	}
	l := listing{mtime: mtime}
	for _, e := range entries {
		name := e.Name()
		switch {
		case e.IsDir() && !t.skipsDir(name):
			l.subdirs = append(l.subdirs, filepath.Join(dir, name))
		case !e.IsDir() && t.isWatched(name):
			l.files = append(l.files, filepath.Join(dir, name))
		}
	}
	return l, true
}

// skipsDir reports whether the Tree never descends into a directory of this name.
func (t *Tree) skipsDir(name string) bool { return t.skipped[name] || strings.HasPrefix(name, ".") }

// stampFile writes a file's path, size and mtime straight into the hash.
func stampFile(h hash.Hash64, path string, info fs.FileInfo) {
	var stamp [16]byte
	_, _ = io.WriteString(h, path)
	binary.LittleEndian.PutUint64(stamp[:8], uint64(info.Size()))
	binary.LittleEndian.PutUint64(stamp[8:], uint64(info.ModTime().UnixNano()))
	_, _ = h.Write(stamp[:])
}

func isWatchedFile(name string) bool {
	return (strings.HasSuffix(name, ".go") && !strings.HasSuffix(name, "_test.go")) || name == "go.mod" || name == "go.sum" || name == "go.work"
}

// Swapper owns the one running child. Build writes the binary; Start runs it.
type Swapper struct {
	Build func(ctx context.Context) error
	Start func(ctx context.Context) (*exec.Cmd, error)
	Grace time.Duration // SIGTERM to SIGKILL
	Log   func(string)
	child *exec.Cmd
	done  chan struct{}
}

// Rebuild builds, then swaps in sequence. A failed build returns its error and
// leaves the running child alone.
func (s *Swapper) Rebuild(ctx context.Context) error {
	if err := s.Build(ctx); err != nil {
		if s.child != nil {
			s.Log("build failed; the running child keeps serving until the next change")
		} else {
			s.Log("build failed; waiting for the next change")
		}
		return err
	}
	s.Stop()
	cmd, err := s.Start(ctx)
	if err != nil {
		return err
	}
	s.child, s.done = cmd, make(chan struct{})
	go func(done chan struct{}) {
		if err := cmd.Wait(); err != nil {
			s.Log(fmt.Sprintf("child exited (%v); waiting for the next change", err))
		}
		close(done)
	}(s.done)
	return nil
}

// Stop ends the running child: SIGTERM, then SIGKILL after Grace.
func (s *Swapper) Stop() {
	if s.child == nil {
		return
	}
	select {
	case <-s.done:
	default:
		_ = s.child.Process.Signal(syscall.SIGTERM)
		select {
		case <-s.done:
		case <-time.After(s.Grace):
			_ = s.child.Process.Kill()
			<-s.done
		}
	}
	s.child = nil
}

// Pid is the running child's pid, or 0.
func (s *Swapper) Pid() int {
	if s.child == nil {
		return 0
	}
	return s.child.Process.Pid
}

// Watcher watches a checkout's Go trees and drives the swapper: file events
// wake it, with Poll the fallback when the operating system refuses them.
type Watcher struct {
	RepoRoot string
	Clock    *Clock
	Swapper  *Swapper
	Poll     time.Duration
	last     uint64
	tree     *Tree
}

// Run builds and starts once, then rebuilds on every due burst until ctx ends.
func (w *Watcher) Run(ctx context.Context) error {
	defer w.Swapper.Stop()
	w.tree = GoTree(w.RepoRoot)
	w.last = w.tree.Fingerprint()
	_ = w.Swapper.Rebuild(ctx)
	loop := Loop{Tree: w.tree, Clock: w.Clock, Poll: w.Poll, Safety: SafetyPoll, Log: w.Swapper.Log}
	loop.Run(ctx, func(now time.Time) bool {
		w.observe(ctx, now)
		return false
	})
	return nil
}

// observe feeds one wake to the clock and rebuilds when the burst is due.
// Changes made during the build wake the loop again: one rebuild follows.
func (w *Watcher) observe(ctx context.Context, now time.Time) {
	if w.tree == nil {
		w.tree = GoTree(w.RepoRoot)
	}
	if fp := w.tree.Fingerprint(); fp != w.last {
		w.last = fp
		w.Clock.Change(now)
	}
	if w.Clock.Due(now) {
		w.Clock.Reset()
		w.Swapper.Log("Go source changed; rebuilding")
		_ = w.Swapper.Rebuild(ctx)
	}
}
