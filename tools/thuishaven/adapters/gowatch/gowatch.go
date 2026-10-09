// Package gowatch is haven's Go hot reload for a stack's combined child: it
// watches the Go trees, waits out a quiet window, rebuilds the one binary and
// swaps the running child for the new one (HAVEN-SWAP: stop old, start new).
// A failed build keeps the old child serving. It replaces air.
package gowatch

import (
	"context"
	"fmt"
	"hash/fnv"
	"io/fs"
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

// watchedDirs are the Go trees `./cmd/service` builds from.
var watchedDirs = []string{"cmd", "pkg", "services"}

// skippedDirs never hold source the binary is built from.
var skippedDirs = map[string]bool{"node_modules": true, "dist": true, ".bin": true, "vendor": true, "testdata": true}

// Fingerprint hashes every watched file's path, size and mtime. Tests never
// change the binary, and a mass test write is the common AI burst, so
// `_test.go` is not watched.
func Fingerprint(repoRoot string) uint64 {
	return FingerprintPaths(repoRoot, append([]string{"go.work"}, watchedDirs...)...)
}

// FingerprintPaths is Fingerprint over the given files and trees under root.
func FingerprintPaths(root string, paths ...string) uint64 {
	h := fnv.New64a()
	for _, p := range paths {
		top := filepath.Join(root, p)
		_ = filepath.WalkDir(top, func(path string, d fs.DirEntry, err error) error {
			switch {
			case err != nil:
				return filepath.SkipDir // an unreadable entry ends that directory's walk
			case d.IsDir():
				return skipDir(path, top, d.Name())
			case isWatchedFile(d.Name()):
				if info, err := d.Info(); err == nil {
					_, _ = fmt.Fprintf(h, "%s|%d|%d\n", path, info.Size(), info.ModTime().UnixNano())
				}
			}
			return nil
		})
	}
	return h.Sum64()
}

func skipDir(path, top, name string) error {
	if skippedDirs[name] || (strings.HasPrefix(name, ".") && path != top) {
		return filepath.SkipDir
	}
	return nil
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

// Watcher polls a checkout's Go trees and drives the swapper.
type Watcher struct {
	RepoRoot string
	Clock    *Clock
	Swapper  *Swapper
	Poll     time.Duration
	last     uint64
}

// Run builds and starts once, then rebuilds on every due burst until ctx ends.
func (w *Watcher) Run(ctx context.Context) error {
	defer w.Swapper.Stop()
	w.last = Fingerprint(w.RepoRoot)
	_ = w.Swapper.Rebuild(ctx)
	tick := time.NewTicker(w.Poll)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case now := <-tick.C:
			w.observe(ctx, now)
		}
	}
}

// observe feeds one poll to the clock and rebuilds when the burst is due.
// Changes made during the build show at the next poll: one rebuild follows.
func (w *Watcher) observe(ctx context.Context, now time.Time) {
	if fp := Fingerprint(w.RepoRoot); fp != w.last {
		w.last = fp
		w.Clock.Change(now)
	}
	if w.Clock.Due(now) {
		w.Clock.Reset()
		w.Swapper.Log("Go source changed; rebuilding")
		_ = w.Swapper.Rebuild(ctx)
	}
}
