package gowatch

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// SafetyPoll is the slow re-hash beside file events, a net under any event the
// operating system dropped.
const SafetyPoll = 10 * time.Second

// Events wakes a watch loop when the operating system reports a change under a
// Tree's paths (fsnotify: kqueue on macOS, inotify on Linux). fsnotify is not
// recursive, so every descended directory is watched and a new one is added as
// it appears. A wake is a hint: the loop re-hashes the Tree to decide.
type Events struct {
	tree     *Tree
	fsw      *fsnotify.Watcher
	tops     map[string]bool // the tree's paths, absolute
	mu       sync.Mutex      // guards dirs: forward edits it while WatchCount reads it
	dirs     map[string]bool // the descended directories being watched
	wake     chan struct{}
	lost     chan struct{}
	lostOnce sync.Once
	log      func(string)
}

// WatchEvents starts watching the tree's paths. An error means the operating
// system refused (too many open files, too many inotify watches): keep polling.
func (t *Tree) WatchEvents(log func(string)) (*Events, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	e := &Events{
		tree: t, fsw: fsw, log: log,
		tops: map[string]bool{}, dirs: map[string]bool{},
		wake: make(chan struct{}, 1), lost: make(chan struct{}),
	}
	for _, p := range t.paths {
		if err := e.addTop(filepath.Join(t.root, p)); err != nil {
			_ = fsw.Close()
			return nil, err
		}
	}
	go e.forward()
	return e, nil
}

// Close stops watching.
func (e *Events) Close() { _ = e.fsw.Close() }

// WatchCount is the number of directories under watch.
func (e *Events) WatchCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.dirs)
}

// addTop watches a directory path's whole tree, else the parent of a file path
// (or of a missing one), so its appearing, changing and going are all seen.
func (e *Events) addTop(path string) error {
	e.tops[path] = true
	if info, err := os.Lstat(path); err == nil && info.IsDir() {
		return e.addTree(path)
	}
	if err := e.fsw.Add(filepath.Dir(path)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// addTree watches dir and every directory below it the Tree descends into.
func (e *Events) addTree(dir string) error {
	return filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		switch {
		case err != nil:
			return filepath.SkipDir // gone or unreadable mid-walk: the Tree skips it too
		case !d.IsDir():
			return nil
		case path != dir && e.tree.skipsDir(d.Name()):
			return filepath.SkipDir
		}
		if err := e.fsw.Add(path); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return filepath.SkipDir
			}
			return err
		}
		e.dirs[path] = true
		return nil
	})
}

// forward turns the operating system's events into wakes.
func (e *Events) forward() {
	for {
		select {
		case ev, ok := <-e.fsw.Events:
			if !ok {
				return
			}
			e.handle(ev)
		case err, ok := <-e.fsw.Errors:
			if !ok {
				return
			}
			e.failed(err)
		}
	}
}

// handle wakes the loop for an event that can move the Tree's hash.
func (e *Events) handle(ev fsnotify.Event) {
	e.mu.Lock()
	matters := e.matters(ev)
	e.mu.Unlock()
	if matters {
		e.signal()
	}
}

// failed logs an event error and re-hashes, as an overflow may have dropped a change.
func (e *Events) failed(err error) {
	if !errors.Is(err, fsnotify.ErrEventOverflow) {
		e.log(fmt.Sprintf("file events: %v", err))
	}
	e.signal()
}

// matters reports whether an event can move the Tree's hash, watching any new
// directory it descends into on the way.
func (e *Events) matters(ev fsnotify.Event) bool {
	path := ev.Name
	if e.tops[path] {
		if e.isNewDir(ev) {
			e.add(path)
		}
		return true
	}
	if e.dirs[path] && ev.Has(fsnotify.Remove|fsnotify.Rename) {
		e.forget(path)
		return true
	}
	if !e.dirs[filepath.Dir(path)] {
		return false // another file beside a watched top-level file
	}
	if e.isNewDir(ev) {
		if e.tree.skipsDir(filepath.Base(path)) {
			return false
		}
		e.add(path)
		return true
	}
	return e.tree.isWatched(filepath.Base(path))
}

func (e *Events) isNewDir(ev fsnotify.Event) bool {
	if !ev.Has(fsnotify.Create) {
		return false
	}
	info, err := os.Lstat(ev.Name)
	return err == nil && info.IsDir()
}

// add watches a new directory's tree; a refusal hands the loop back to polling.
func (e *Events) add(dir string) {
	if err := e.addTree(dir); err != nil {
		e.lostOnce.Do(func() {
			e.log(fmt.Sprintf("file events stopped (%v)", err))
			close(e.lost)
		})
	}
}

// forget drops a removed or renamed directory and everything below it.
func (e *Events) forget(dir string) {
	prefix := dir + string(filepath.Separator)
	for d := range e.dirs {
		if d == dir || strings.HasPrefix(d, prefix) {
			delete(e.dirs, d)
			_ = e.fsw.Remove(d)
		}
	}
}

func (e *Events) signal() {
	select {
	case e.wake <- struct{}{}:
	default:
	}
}

// Loop runs a watch: it re-hashes on every file event, every Safety as a net,
// and when the clock's pending burst falls due. When the operating system
// refuses file events it polls every Poll instead, as the watchers always did.
type Loop struct {
	Tree         *Tree
	Clock        *Clock
	Poll, Safety time.Duration
	Log          func(string)
}

// Run calls observe on each wake until ctx ends or observe returns true.
func (l Loop) Run(ctx context.Context, observe func(now time.Time) bool) {
	interval := l.Poll
	var wake, lost <-chan struct{}
	if ev, err := l.Tree.WatchEvents(l.Log); err != nil {
		l.Log(fmt.Sprintf("no file events (%v); polling every %s", err, l.Poll))
	} else {
		defer ev.Close()
		wake, lost, interval = ev.wake, ev.lost, l.Safety
	}
	tick := time.NewTicker(interval)
	defer tick.Stop()
	due := time.NewTimer(time.Hour)
	due.Stop()
	defer due.Stop()
	for {
		var now time.Time
		select {
		case <-ctx.Done():
			return
		case now = <-tick.C:
		case now = <-due.C:
		case <-wake:
			now = time.Now()
		case <-lost:
			wake, lost = nil, nil
			l.Log(fmt.Sprintf("polling every %s", l.Poll))
			tick.Reset(l.Poll)
			now = time.Now()
		}
		if observe(now) {
			return
		}
		l.arm(due, now)
	}
}

// arm sets the timer for the pending burst. A burst already due but held back
// (the UI's first bundle not built yet) is retried every Poll.
func (l Loop) arm(due *time.Timer, now time.Time) {
	at := l.Clock.DueAt()
	switch {
	case at.IsZero():
		due.Stop()
	case at.After(now):
		due.Reset(max(time.Until(at), 0))
	default:
		due.Reset(l.Poll)
	}
}
