package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/gowatch"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// uiWatchArgv is this Haven executable plus its internal UI watch command.
func uiWatchArgv() []string {
	return []string{simulatorArgv()[0], "ui-watch"}
}

// runUIWatch is a watching built-UI stack's ui lane: on a due burst of browser
// source changes it runs app.UIBuildShell, a one-shot `vite build` that exits
// and frees its memory. It never builds at start (the app lane builds a missing
// bundle); a failed build leaves the last good bundle serving.
func runUIWatch(ctx context.Context, _ deps, _ invocation) error {
	repoRoot, err := os.Getwd()
	if err != nil {
		return err
	}
	logf := func(msg string) { fmt.Fprintln(os.Stderr, "haven ui-watch: "+msg) }
	clock := &gowatch.Clock{
		Quiet:   envMillis("LANGWATCH_UI_WATCH_DEBOUNCE_MS", 5*time.Second),
		MaxWait: envMillis("LANGWATCH_UI_WATCH_MAX_WAIT_MS", 60*time.Second),
	}
	served := filepath.Join(repoRoot, app.UIDirRel, "dist", "client", "index.html")
	last := gowatch.UIFingerprint(repoRoot)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case now := <-tick.C:
			if fp := gowatch.UIFingerprint(repoRoot); fp != last {
				last = fp
				clock.Change(now)
			}
			// Wait out the app lane's first build rather than racing it into client.next.
			if _, err := os.Stat(served); err != nil || !clock.Due(now) {
				continue
			}
			clock.Reset() // changes made during the build start the next burst
			logf("UI source changed; rebuilding")
			start := time.Now()
			build := exec.CommandContext(ctx, "sh", "-c", app.UIBuildShell)
			build.Dir, build.Stdout, build.Stderr = repoRoot, os.Stderr, os.Stderr
			if err := build.Run(); err != nil {
				logf(fmt.Sprintf("build failed after %s (%v); the last good bundle keeps serving", time.Since(start).Round(time.Millisecond), err))
				continue
			}
			logf(fmt.Sprintf("ui bundle swapped in after %s", time.Since(start).Round(time.Millisecond)))
		}
	}
}
