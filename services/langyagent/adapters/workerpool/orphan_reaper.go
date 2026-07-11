package workerpool

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
)

// StartOrphanReaper drains zombies for any process re-parented to the manager.
// The manager is PID 1 inside the langyagent pod (entrypoint.sh uses `exec
// "$@"`), and only PID 1 may reap orphans whose parent died.
//
// Why this matters: opencode forks children (`gh`, `git`, `npm`) that inherit
// the worker pgroup (Setpgid: true). When the manager kills the worker via
// syscall.Kill(-pgid, ...), every member of the pgroup gets the signal —
// including opencode's children. Once they exit, those children's zombie
// entries accumulate under PID 1 until reaped. Without this loop, long-running
// pods leak process-table entries one per turn that recycles a worker,
// eventually hitting the kernel pid_max limit or the container's nproc rlimit.
//
// Go's runtime does NOT auto-reap PID 1's adopted orphans; the standard idiom is
// a SIGCHLD-driven Wait4(-1, WNOHANG, ...) loop.
//
// No-op when the manager isn't PID 1 (Wait4 returns ECHILD immediately because
// no orphans get reparented to a non-init PID). Fire-and-forget: it spawns a
// goroutine that stops when ctx is cancelled, so it plugs straight into a
// pkg/lifecycle Worker.
func StartOrphanReaper(ctx context.Context) {
	log := clog.Get(ctx)
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGCHLD)
	go func() {
		defer signal.Stop(sigs)
		for {
			select {
			case <-ctx.Done():
				return
			case <-sigs:
				// Drain every reapable child in a tight loop — one SIGCHLD can
				// coalesce multiple child exits.
				for {
					var status syscall.WaitStatus
					pid, err := syscall.Wait4(-1, &status, syscall.WNOHANG, nil)
					if err == syscall.ECHILD || pid <= 0 {
						break
					}
					if err != nil {
						log.Debug("orphan reaper Wait4 error", zap.Error(err))
						break
					}
					log.Debug("reaped orphan child",
						zap.Int("pid", pid),
						zap.Int("exit", status.ExitStatus()),
					)
				}
			}
		}
	}()
}
