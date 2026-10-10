package visualdiff

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// smokeEntrypoints are the apps whose import graph must load before haven up.
var smokeEntrypoints = []string{"apps/tasks", "apps/api", "apps/worker"}

// ImportSmoke loads each entrypoint's module graph without running it (each
// main is guarded by import.meta.main) and fails, with the last output and a
// process sample, on the first that crashes or outlives timeout.
func ImportSmoke(ctx context.Context, dir string, timeout time.Duration) error {
	for _, app := range smokeEntrypoints {
		if _, err := os.Stat(filepath.Join(dir, app, "src", "main.ts")); err != nil {
			continue
		}
		if err := smokeOne(ctx, filepath.Join(dir, app), timeout); err != nil {
			return fmt.Errorf("stack-broken: import smoke of %s: %w", app, err)
		}
	}
	return nil
}

func smokeOne(ctx context.Context, dir string, timeout time.Duration) error {
	var out bytes.Buffer
	command := exec.CommandContext(ctx, "node", "--experimental-transform-types", "--input-type=module",
		"-e", "await import('./src/main.ts'); process.exit(0)")
	command.Dir, command.Stdout, command.Stderr = dir, &out, &out
	if err := command.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("%w\nlast output:\n%s", err, havenrun.LastLines(out.String(), 20))
		}
		return nil
	case <-time.After(timeout):
		sample := processSample(command.Process.Pid)
		_ = command.Process.Signal(syscall.SIGKILL)
		<-done
		return fmt.Errorf("%w after %s\nlast output:\n%s\nprocess sample:\n%s",
			errSmokeHang, timeout, havenrun.LastLines(out.String(), 20), sample)
	}
}

var errSmokeHang = errors.New("did not finish loading")

// processSample is the head of macOS `sample`'s call graph for pid: enough to see where it waits.
func processSample(pid int) string {
	out, err := exec.CommandContext(context.Background(), "sample", strconv.Itoa(pid), "1").CombinedOutput()
	_, graph, found := strings.Cut(string(out), "Call graph:")
	if err != nil || !found {
		return processTree(pid)
	}
	lines := strings.Split(graph, "\n")
	return strings.Join(lines[:min(len(lines), 40)], "\n")
}
