package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/gowatch"
)

// goWatchArgv is this Haven executable plus its internal Go watch command.
func goWatchArgv() []string {
	return []string{simulatorArgv()[0], "go-watch"}
}

// envMillis reads a millisecond knob, the unit the Node lane's watch uses.
func envMillis(key string, def time.Duration) time.Duration {
	if ms, err := strconv.Atoi(devEnv(key)); err == nil && ms > 0 {
		return time.Duration(ms) * time.Millisecond
	}
	return def
}

// runGoWatch is a go lane's process when watching: `haven go-watch <binary>
// <service>…` builds ./cmd/service into <binary>, runs `<binary> combined
// <service>…` and rebuilds and swaps it on a Go change. The working directory
// is the checkout; the lane's shell has loaded its env.
func runGoWatch(ctx context.Context, _ deps, inv invocation) error {
	if len(inv.args) < 2 {
		return fmt.Errorf("haven go-watch requires <binary> <service>…")
	}
	repoRoot, err := os.Getwd()
	if err != nil {
		return err
	}
	binary, services := inv.args[0], inv.args[1:]
	logf := func(msg string) { fmt.Fprintln(os.Stderr, "haven go-watch: "+msg) }
	swapper := &gowatch.Swapper{
		Build: func(ctx context.Context) error {
			if err := os.MkdirAll(filepath.Dir(binary), 0o750); err != nil {
				return err
			}
			build := exec.CommandContext(ctx, "go", "build", "-tags", "dev", "-o", binary, "./cmd/service")
			build.Dir, build.Stdout, build.Stderr = repoRoot, os.Stderr, os.Stderr
			return build.Run()
		},
		Start: func(ctx context.Context) (*exec.Cmd, error) {
			child := exec.CommandContext(ctx, binary, append([]string{"combined"}, services...)...) //nolint:gosec // the binary this watch just built
			child.Cancel = func() error { return child.Process.Signal(syscall.SIGTERM) }
			child.WaitDelay = 10 * time.Second
			child.Dir, child.Stdout, child.Stderr = repoRoot, os.Stdout, os.Stderr
			err := child.Start()
			return child, err
		},
		Grace: 10 * time.Second,
		Log:   logf,
	}
	clock := &gowatch.Clock{
		Quiet:   envMillis("LANGWATCH_DEV_WATCH_DEBOUNCE_MS", 2*time.Second),
		MaxWait: envMillis("LANGWATCH_DEV_WATCH_MAX_WAIT_MS", 30*time.Second),
	}
	watcher := &gowatch.Watcher{RepoRoot: repoRoot, Clock: clock, Swapper: swapper, Poll: 500 * time.Millisecond}
	return watcher.Run(ctx)
}
