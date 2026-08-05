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
// The manager is PID 1 inside the langyagent pod (the binary is the image
// ENTRYPOINT, exec form — no shell wrapper), and only PID 1 may reap orphans
// whose parent died.
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
// GATED ON PID 1, and that gate is load-bearing rather than cosmetic.
// Wait4(-1, ...) matches ANY child of this process, not merely a reparented
// orphan — and the manager always has direct children, namely the worker
// subprocesses. So off PID 1 this loop does not idle; it races
// Pool.spawnInner's exit watcher for the pool's own workers. Whichever caller
// reaps first wins, and the loser's cmd.Wait() returns ECHILD, which would
// report a clean exit as "waitid: no child processes" and discard the real exit
// status. Reaping orphans is only PID 1's job in the first place, so confining
// the loop to PID 1 removes the race everywhere it is pure downside — tests,
// local dev, any non-init packaging.
//
// THE GATE DOES NOT REMOVE THAT RACE ON PID 1, and it cannot. In the pod the
// manager is init AND the workers' parent, so the same Wait4(-1) that drains
// adopted orphans is equally eligible for a worker the pool is waiting on. The
// only way to close it properly is to stop having two owners: route every child
// exit through one reaper that dispatches statuses to whoever is waiting,
// instead of pairing each spawn with its own cmd.Wait(). That is a real change
// to process ownership, not a tweak, and it is deliberately not made here.
//
// What the residual race costs, checked rather than assumed: nothing in this
// service reads a worker's exit status. `ProcessState`, `ExitCode()` and
// `.Sys()` appear nowhere outside tests; `onWorkerExit` takes cmd only to
// compare identity. The single consumer of cmd.Wait()'s error is the "worker
// exited" log line in spawnInner's exit watcher. So when the reaper wins, that
// line reads "waitid: no child processes" instead of the true status — a
// degraded diagnostic on a path nothing branches on. Worth fixing one day;
// not worth a process-ownership redesign inside a retrospective bug-fix.
//
// Fire-and-forget: it spawns a goroutine that stops when ctx is canceled, so
// it plugs straight into a pkg/lifecycle Worker. The goroutine is launched via
// clog.Go so a panic can never crash the manager, and each SIGCHLD-drain is
// additionally guarded so a panic in one drain can't silently end zombie-reaping
// forever.
//
// Reports whether the loop actually armed, so the caller can record the outcome
// — the PID-1 requirement is stated in the Dockerfile as a comment only, and a
// future `--init`/tini/shell entrypoint or a chart `command:` override would
// silently demote the manager off init.
func StartOrphanReaper(ctx context.Context) bool {
	started, _ := startOrphanReaper(ctx, os.Getpid())
	return started
}

// startOrphanReaper is StartOrphanReaper with the PID injected so the gate is
// testable off init. It reports whether the reaper loop was started, plus a
// channel closed once that goroutine has fully stopped — the signal handler is
// already deregistered by then, so a test can wait on it instead of leaking a
// live SIGCHLD handler into the next test. done is nil when the reaper declined.
func startOrphanReaper(ctx context.Context, pid int) (started bool, done <-chan struct{}) {
	log := clog.Get(ctx)
	if pid != 1 {
		// Not init: nothing reparents here, and Wait4(-1) would only steal the
		// pool's own worker exits from cmd.Wait(). Info, not Debug: production
		// runs at info level, and this line is the ONLY signal that the stated
		// PID-1 invariant broke. Not Warn — under an init wrapper (tini, docker
		// --init) that init reaps the orphans itself, so nothing leaks; what is
		// lost is the guarantee, not the behavior.
		log.Info("orphan reaper not started: manager is not PID 1, so the stated PID-1 invariant no longer holds",
			zap.Int("pid", pid),
		)
		return false, nil
	}
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGCHLD)
	stopped := make(chan struct{})
	clog.Go(ctx, "orphan-reaper", func() {
		// LIFO: signal.Stop runs first, so by the time stopped closes this
		// process is no longer receiving SIGCHLD on our behalf.
		defer close(stopped)
		defer signal.Stop(sigs)
		for {
			select {
			case <-ctx.Done():
				return
			case <-sigs:
				// Per-iteration recovery: a panic while draining one SIGCHLD batch
				// must not tear down the reaper loop — losing it would leak zombies
				// (one per recycled worker) until the pod hits its process limit.
				func() {
					defer clog.HandlePanic(ctx, false)
					drainOrphans(log)
				}()
			}
		}
	})
	return true, stopped
}

// drainOrphans reaps every currently-reapable child in a tight loop — one
// SIGCHLD can coalesce multiple child exits.
func drainOrphans(log *zap.Logger) {
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
