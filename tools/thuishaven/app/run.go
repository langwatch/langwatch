package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// HeavyRun describes one gated run. Shell is the caller's original command
// line, passed through untouched — `haven run` runs it under a shell rather
// than re-parsing it, because the gate handed it over as one escaped argument
// precisely so nothing would be re-split.
type HeavyRun struct {
	Shell string
	Dir   string
	// AgentID is empty for a main session and set inside a sub-agent. It picks
	// the wait ceiling, because it picks the prompt-cache floor.
	AgentID string
	// Interactive marks a human at a terminal, who gets the long failsafe and
	// no tightening at all.
	Interactive bool
	// Workers is the narrowed width the gate decided on, zero when the run was
	// not narrowed. It is applied to the run's environment rather than spliced
	// into the command, so a command that already chose its own width keeps it.
	Workers int
}

// slotState is the machine's occupancy at one moment: how many heavy runs are
// live, and how many are allowed.
type slotState struct{ live, limit int }

func (s slotState) free() bool    { return s.live < s.limit }
func (s slotState) position() int { return s.live - s.limit + 1 }

// RunHeavy takes a machine-wide slot, runs the command, and releases.
//
// The slot is what makes this worth existing: every worktree, terminal and
// agent on the machine counts against the same total, so N parallel test runs
// cannot all start at once. On the happy path it prints nothing and is
// transparent — it speaks only when a run has to wait, which is exactly when
// the caller needs to know the extra minutes were queueing rather than a hung
// command.
//
// The wait is bounded by the CALLER's ceiling, not a constant: a sub-agent
// holds the five-minute prompt cache and a main session an hour, so holding
// them to the same limit would either park the first past its floor or
// needlessly hurry the second.
func (o *Orchestrator) RunHeavy(ctx context.Context, r HeavyRun) error {
	caller := domain.CallerFromAgentID(r.AgentID, r.Interactive)
	key := domain.DurationKey(r.Shell)

	waited, queued, release, err := o.takeHeavySlot(ctx, waiter{caller: caller, shell: r.Shell})
	if err != nil {
		return err
	}
	defer release()

	// Only speak if we actually queued. On the happy path this command is
	// transparent — the wait is microseconds, and reporting "waited 0s" would
	// train the reader to ignore the line that matters.
	//
	// STDERR, not stdout: the wrapped command owns stdout, and a caller piping
	// `haven run --sh 'oxlint ... --format=json'` must get its JSON and nothing
	// else. The reader still sees these lines either way.
	if queued {
		fmt.Fprintf(os.Stderr, "haven: waited %s for a heavy slot\n", waited.Round(time.Second))
	}

	started := o.sys.Now()
	// Nested explicit Haven commands recognize this owner instead of taking
	// another slot behind the one this process already holds.
	env := []string{"CHECK_SLOTS=0", "CHECK_QUEUE_HELD=" + strconv.Itoa(os.Getpid()), "HAVEN_SLOT_HELD=1"}
	if r.Workers > 0 {
		env = append(env, "VITEST_MAX_WORKERS="+strconv.Itoa(r.Workers))
	}
	err = o.sup.RunOnce(ctx, "heavy", r.Dir, r.Shell, env)
	if err == nil {
		// Only a completed run is evidence of how long this kind of command takes.
		// A suite that died after two seconds would otherwise file two seconds
		// against the key, and the next caller would be narrowed on the strength
		// of a crash.
		o.store.ObserveDuration(key, o.sys.Now().Sub(started))
	}
	return err
}

// waiter is who is asking for a slot and what for: the caller kind picks the
// ceiling, and the shell is what gets recorded against the claim.
type waiter struct {
	caller domain.CallerKind
	shell  string
}

// takeHeavySlot uses the same flock pool as manual checks. The claim ledger is
// telemetry only; acquiring a second admission gate would count one run twice.
func (o *Orchestrator) takeHeavySlot(ctx context.Context, w waiter) (time.Duration, bool, func(), error) {
	waited, queued, release, err := o.acquireCheckSlot(ctx, w.caller.WaitCeiling())
	if err != nil {
		return waited, queued, release, err
	}
	claimRelease, claimErr := o.store.ClaimHeavyRun(o.sys.Getpid(), w.shell)
	if claimErr != nil {
		o.log.Warn("could not record heavy-run telemetry")
		return waited, queued, release, nil
	}
	return waited, queued, func() { claimRelease(); release() }, nil
}

func (o *Orchestrator) checkSlots() int {
	pressure := domain.ResolveCheckPressure(o.cfg.CheckPressure, domain.ClassifyPressure(o.sys.MemStat()), o.cfg.CheckEnv.CI)
	slots, _ := domain.ResolveCheckSlots(domain.CheckMachine{
		TotalRAMBytes: o.sys.TotalMemory(), NumCPU: runtime.NumCPU(), Pressure: pressure,
	}, o.cfg.CheckEnv)
	return slots
}

func (o *Orchestrator) acquireCheckSlot(ctx context.Context, ceiling time.Duration) (time.Duration, bool, func(), error) {
	noRelease := func() {}
	if err := ctx.Err(); err != nil {
		return 0, false, noRelease, err
	}
	slots := o.checkSlots()
	if slots == 0 {
		return 0, false, noRelease, nil
	}
	if o.sem == nil {
		return 0, false, noRelease, fmt.Errorf("semaphore not wired")
	}
	start := time.Now()
	waitCtx, cancel := context.WithTimeout(ctx, ceiling)
	defer cancel()
	var queued atomic.Bool
	done, announced := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(announced)
		timer := time.NewTimer(150 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-done:
		case <-timer.C:
			queued.Store(true)
			fmt.Fprintf(os.Stderr, "haven: waiting for a shared check slot (limit %d)\n", slots)
		}
	}()
	release, _, err := o.sem.Acquire(waitCtx, "checks", slots)
	close(done)
	<-announced
	waited := time.Since(start)
	if err != nil {
		if ctx.Err() != nil {
			return waited, queued.Load(), noRelease, ctx.Err()
		}
		if errors.Is(err, context.DeadlineExceeded) {
			fmt.Fprintf(os.Stderr, "haven: no slot after %s, starting anyway\n", waited.Round(time.Second))
			return waited, true, noRelease, nil
		}
		o.log.Warn("could not acquire the shared check slot; running uncounted")
		return waited, queued.Load(), noRelease, nil
	}
	return waited, queued.Load(), release, nil
}
