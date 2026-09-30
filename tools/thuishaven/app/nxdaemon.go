package app

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// NxDaemon is one live Nx daemon and the worktree it serves.
type NxDaemon struct {
	PID      int    `json:"pid"`
	Worktree string `json:"worktree"`
	RSS      int64  `json:"rssBytes"`
}

// nxDaemonStopTimeout bounds `nx daemon --stop`: down must never hang on it.
const nxDaemonStopTimeout = 15 * time.Second

// NxDaemons lists every Nx daemon running on the machine.
func (o *Orchestrator) NxDaemons() []NxDaemon {
	var out []NxDaemon
	for _, s := range o.sys.ProcessSamples() {
		if dir, ok := domain.NxDaemonWorktree(s.Command); ok {
			out = append(out, NxDaemon{PID: s.PID, Worktree: dir, RSS: s.RSSBytes})
		}
	}
	return out
}

// stopNxDaemon asks the worktree's own Nx to stop its daemon, when one runs.
// Best-effort: a failure is logged, never returned, so down still completes.
func (o *Orchestrator) stopNxDaemon(ctx context.Context, worktree string) {
	if worktree == "" || !o.hasNxDaemon(worktree) {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, nxDaemonStopTimeout)
	defer cancel()
	if err := o.sup.RunOnce(ctx, "nx-daemon", worktree, "./node_modules/.bin/nx daemon --stop >/dev/null", nil); err != nil {
		o.log.Warn("could not stop the Nx daemon", zap.String("worktree", worktree), zap.Error(err))
	}
}

func (o *Orchestrator) hasNxDaemon(worktree string) bool {
	want := filepath.Clean(worktree)
	for _, d := range o.NxDaemons() {
		if filepath.Clean(d.Worktree) == want {
			return true
		}
	}
	return false
}

// reapOrphanNxDaemons stops the Nx daemons whose worktree has been deleted:
// nothing can ever ask them to stop, and each holds a file watcher and a graph.
func (o *Orchestrator) reapOrphanNxDaemons() {
	for _, d := range o.NxDaemons() {
		if _, err := os.Stat(d.Worktree); !errors.Is(err, fs.ErrNotExist) {
			continue
		}
		o.sys.Terminate(d.PID)
		o.recordReap("nx-daemon", d.Worktree, "worktree no longer exists")
		o.log.Info("stopped an Nx daemon whose worktree is gone", zap.Int("pid", d.PID), zap.String("worktree", d.Worktree))
	}
}
