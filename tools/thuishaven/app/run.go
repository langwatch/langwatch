package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// HeavyRun describes one gated run. Shell is the caller's original command
// line, passed through untouched — `haven machine run` runs it under a shell rather
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
	// `haven machine run --sh 'oxlint ... --format=json'` must get its JSON and nothing
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
	took := o.sys.Now().Sub(started)
	if err == nil {
		// Only a completed run is evidence of how long this kind of command takes.
		// A suite that died after two seconds would otherwise file two seconds
		// against the key, and the next caller would be narrowed on the strength
		// of a crash.
		o.store.ObserveDuration(key, took)
	}
	// The wait estimate's history keeps a failed run too (its exit status is
	// part of the record), unlike the narrowing estimate above - best effort,
	// since a history write must never be why a real run fails.
	if histErr := o.store.AppendRunHistory(domain.RunRecord{
		Kind: domain.ClassifyHistoryKind(r.Shell), StartedAt: started, Duration: took, ExitCode: exitCodeOf(err),
	}); histErr != nil {
		o.log.Warn("could not record run history", zap.Error(histErr))
	}
	return err
}

// exitCodeOf reads a completed run's exit status out of the error RunOnce
// returned: 0 for success, the process's own code when it ran and failed, -1
// when it could not be determined (it never started, or was killed by signal).
func exitCodeOf(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
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

// checkUnits is the machine's check budget in core units, the one counter
// `haven machine slot run` shares (D1, dev/docs/plans/haven-exec-policy.md).
func (o *Orchestrator) checkUnits() int { return o.checkCapacity().Units }

// checkCapacity is the budget a run is admitted against now and why: the
// pressure budget, grown on a quiet machine, halved behind a waited-on boot.
func (o *Orchestrator) checkCapacity() domain.Capacity {
	mem := o.sys.MemStat()
	pressure := domain.ResolveCheckPressure(o.cfg.CheckPressure, domain.ClassifyPressure(mem), o.cfg.CheckEnv.CI)
	return o.capacityAt(pressure, mem)
}

// capacityAt resolves the capacity for a pressure level already settled: the
// daemon's published tier when fresh, else this sample stepped from normal.
func (o *Orchestrator) capacityAt(pressure domain.Pressure, mem domain.MemStat) domain.Capacity {
	var reading domain.CapacityReading
	fresh := false
	var stacks []string
	if o.store != nil {
		rec, ok := o.store.ReadPressure()
		reading, fresh = domain.ReadCapacity(rec, ok, o.sys.Now())
		for _, claim := range o.store.WaiterClaims(domain.BootWaitName) {
			stacks = append(stacks, claim.Label)
		}
	}
	if !fresh {
		reading = domain.MeasureCapacity(domain.CapacityNormal, domain.SampleLoad(o.sys.LoadAverage(), runtime.NumCPU(), mem))
	}
	boots, _ := domain.BootsWaitedOn(stacks, "")
	return domain.ResolveCapacity(domain.CapacityRequest{
		Machine: domain.CheckMachine{TotalRAMBytes: o.sys.TotalMemory(), NumCPU: runtime.NumCPU(), Pressure: pressure},
		Env:     o.cfg.CheckEnv, Reading: reading, BootsWaited: boots,
	})
}

// checkSlots is how many two-unit checks the budget holds; zero is the gate off.
func (o *Orchestrator) checkSlots() int {
	units := o.checkUnits()
	if units <= 0 {
		return 0
	}
	return max(1, units/domain.UnitsPerCheck)
}

// checkClaim is one two-unit run of class on the check budget.
func (o *Orchestrator) checkClaim(class domain.SlotClass, label string) domain.SlotClaim {
	return domain.SlotClaim{
		PID: o.sys.Getpid(), Class: string(class), Units: domain.UnitsPerCheck,
		Worktree: o.cfg.RepoRoot, Label: label, StartedAt: time.Now(),
	}
}

// acquireUnits waits for claim.Units of the check budget, polling as the
// semaphore's own Acquire does; ctx ends the wait.
func (o *Orchestrator) acquireUnits(ctx context.Context, budget int, claim domain.SlotClaim) (func(), error) {
	for {
		claim.StartedAt = time.Now()
		release, ok, err := o.sem.TryAcquireUnits("checks", budget, claim)
		if err != nil {
			return nil, err
		}
		if ok {
			return release, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (o *Orchestrator) acquireCheckSlot(ctx context.Context, ceiling time.Duration) (time.Duration, bool, func(), error) {
	noRelease := func() {}
	if err := ctx.Err(); err != nil {
		return 0, false, noRelease, err
	}
	capacity := o.checkCapacity()
	units := capacity.Units
	if units == 0 {
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
			fmt.Fprintf(os.Stderr, "haven: waiting for a shared check slot (%s)\n", capacity.Describe())
		}
	}()
	release, err := o.acquireUnits(waitCtx, units, o.checkClaim(domain.ClassCheck, "haven gate"))
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
