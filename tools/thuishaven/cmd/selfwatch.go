package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/gowatch"
)

// selfWatchedPaths are the sources a haven binary is built from, under the
// checkout root.
var selfWatchedPaths = []string{"go.work", "cmd/haven", "tools/go.mod", "tools/go.sum", "tools/thuishaven"}

// selfSourceRoot is the checkout this binary was compiled from (D4): the
// compiler records this file's absolute path. "" when that checkout is gone or
// the build trimmed its paths, which turns the self-watch off.
func selfSourceRoot() string {
	_, file, _, ok := runtime.Caller(0)
	if !ok || !filepath.IsAbs(file) {
		return ""
	}
	root := filepath.Join(filepath.Dir(file), "..", "..", "..")
	if _, err := os.Stat(filepath.Join(root, "cmd", "haven", "main.go")); err != nil {
		return ""
	}
	return root
}

// selfWatch rebuilds the daemon's own binary when haven's sources change and
// hands over to a successor running it (plan 11.5). A failed build keeps this
// daemon serving; stacks never notice either way.
type selfWatch struct {
	root, exe string
	clock     *gowatch.Clock
	poll      time.Duration
	build     func(ctx context.Context, out string) error
	handOver  func() error
	log       func(string)
	last      uint64
}

// newSelfWatch is the daemon's watcher, or nil when it cannot rebuild itself:
// LANGWATCH_GO_WATCH=0 (D5), a `go run` binary, or no source checkout.
func newSelfWatch(handOver func() error) *selfWatch {
	if devEnv("LANGWATCH_GO_WATCH") == "0" {
		return nil
	}
	root := selfSourceRoot()
	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if root == "" || err != nil || strings.Contains(exe, "go-build") || strings.HasPrefix(exe, os.TempDir()) {
		return nil
	}
	return &selfWatch{
		root: root,
		exe:  exe,
		clock: &gowatch.Clock{
			Quiet:   envMillis("LANGWATCH_DEV_WATCH_DEBOUNCE_MS", 2*time.Second),
			MaxWait: envMillis("LANGWATCH_DEV_WATCH_MAX_WAIT_MS", 30*time.Second),
		},
		poll: time.Second,
		build: func(ctx context.Context, out string) error {
			build := exec.CommandContext(ctx, "go", "build", "-o", out, "./cmd/haven")
			build.Dir, build.Stdout, build.Stderr = root, os.Stderr, os.Stderr
			return build.Run()
		},
		handOver: handOver,
		log:      func(msg string) { fmt.Fprintln(os.Stderr, "haven daemon: "+msg) },
	}
}

// run polls until ctx ends or a rebuild has handed over.
func (w *selfWatch) run(ctx context.Context) {
	w.last = gowatch.FingerprintPaths(w.root, selfWatchedPaths...)
	tick := time.NewTicker(w.poll)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			if w.observe(ctx, now) {
				return
			}
		}
	}
}

// observe feeds one poll to the clock; true once a rebuild has handed over.
func (w *selfWatch) observe(ctx context.Context, now time.Time) bool {
	if fp := gowatch.FingerprintPaths(w.root, selfWatchedPaths...); fp != w.last {
		w.last = fp
		w.clock.Change(now)
	}
	if !w.clock.Due(now) {
		return false
	}
	w.clock.Reset()
	return w.rebuild(ctx)
}

// rebuild builds beside the binary and renames over it, so running keepers
// keep their inode and a failed build leaves the binary untouched.
func (w *selfWatch) rebuild(ctx context.Context) bool {
	w.log("haven source changed; rebuilding " + w.exe)
	next := w.exe + ".next"
	if err := w.build(ctx, next); err != nil {
		_ = os.Remove(next)
		w.log(fmt.Sprintf("rebuild failed (%v); this daemon keeps serving", err))
		return false
	}
	if err := os.Rename(next, w.exe); err != nil {
		_ = os.Remove(next)
		w.log(fmt.Sprintf("could not replace the binary (%v); this daemon keeps serving", err))
		return false
	}
	if err := w.handOver(); err != nil {
		w.log(fmt.Sprintf("rebuilt, but no successor started (%v); this daemon keeps serving", err))
		return false
	}
	w.log("rebuilt; handing over to the successor")
	return true
}

// runDaemon is `haven daemon [restart] [--after <pid>]`.
func runDaemon(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) == 1 {
		return runDaemonRestart(d, inv.args[0])
	}
	var after int
	if v := inv.value("--after"); v != "" {
		if _, err := fmt.Sscan(v, &after); err != nil || after <= 0 {
			return fmt.Errorf("haven daemon: --after needs a pid, got %q", v)
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if w := newSelfWatch(func() error {
		if err := d.orch.StartDaemonSuccessor(os.Getpid(), d.worktree); err != nil {
			return err
		}
		cancel()
		return nil
	}); w != nil {
		go w.run(ctx)
	}
	return d.orch.RunDaemon(ctx, d.dash, after)
}

// runDaemonRestart is `haven daemon restart` (D10).
func runDaemonRestart(d deps, sub string) error {
	if sub != "restart" {
		return fmt.Errorf("haven daemon: unknown subcommand %q (did you mean restart?)", sub)
	}
	pid, err := d.orch.RestartDaemon(d.worktree)
	if err != nil {
		return err
	}
	fmt.Printf("haven daemon restarted (pid %d); every stack kept running\n", pid)
	return nil
}
