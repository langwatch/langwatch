package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// The host's lines that end a reload: a reload finished in place, or a
// recycled host booted again (tools/dev-runtime).
var doneLines = []string{`"msg":"backend reload finished"`, `"msg":"backend ready"`}

const reloadTimeout = 3 * time.Minute

var reloadLanes = []string{"app", "api", "worker"}

// Reload asks the Node host (api, worker and, in one process, the UI) to
// reload its backend in place (SIGUSR2): the UI and its sessions stay up. It
// waits for the host's own finished line. A changed env needs `haven up -f`.
func (o *Orchestrator) Reload(ctx context.Context, p UpParams, name string) error {
	if !slices.Contains(reloadLanes, name) {
		return fmt.Errorf("unknown lane %q — reloadable: %s", name, strings.Join(reloadLanes, ", "))
	}
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	st, ok := o.stackBySlug(slug)
	if !ok {
		return fmt.Errorf("no registered stack %q — is it up? (haven up)", slug)
	}
	if len(restartTargets(st, APILane)) == 0 {
		return fmt.Errorf("this stack has no Node host to reload")
	}
	dir := o.LogDir(slug)
	log := filepath.Join(dir, AppLane+".log")
	if _, err := os.Stat(log); err != nil {
		log = filepath.Join(dir, APILane+".log")
	}
	offset := int64(0)
	if info, err := os.Stat(log); err == nil {
		offset = info.Size()
	}
	if !o.launcherIsOurs(st) {
		return fmt.Errorf("stack %q is not running — start it with `haven up`", slug)
	}
	pids := o.sys.PIDsOnPort(restartTargets(st, APILane)[0].Port)
	if len(pids) == 0 {
		return fmt.Errorf("nothing listens on the Node host's port yet — is it still booting?")
	}
	for _, pid := range pids {
		o.sys.Reload(pid)
	}
	if err := waitForLine(ctx, logWait{path: log, offset: offset, needles: doneLines, timeout: reloadTimeout}); err != nil {
		return err
	}
	fmt.Printf("  %s ready again\n", name)
	return nil
}

// logHas reports whether path, from offset on, holds any of the needles. A log
// shorter than offset was rotated, so it is read whole.
func logHas(path string, offset int64, needles []string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	if offset > int64(len(data)) {
		offset = 0
	}
	text := string(data[offset:])
	return slices.ContainsFunc(needles, func(n string) bool { return strings.Contains(text, n) })
}

// logWait is what waitForLine waits for, and for how long.
type logWait struct {
	path    string
	offset  int64
	needles []string
	timeout time.Duration
}

// waitForLine polls path from offset until a needle appears. It waits on the
// host's own signal and gives up at timeout.
func waitForLine(ctx context.Context, w logWait) error {
	path, offset, needles, timeout := w.path, w.offset, w.needles, w.timeout
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for !logHas(path, offset, needles) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("no ready line in %s after %s — see `haven logs`", filepath.Base(path), timeout)
		case <-tick.C:
		}
	}
	return nil
}
