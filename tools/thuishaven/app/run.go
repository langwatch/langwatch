package app

import (
	"context"
	"fmt"
	"runtime"
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
}

// heavyRunPoll is how often a waiter re-checks. Frequent enough that a freed
// slot is taken promptly, rare enough that a dozen waiters cost nothing.
const heavyRunPoll = 500 * time.Millisecond

// slotState is the machine's occupancy at one moment: how many heavy runs are
// live, and how many are allowed.
type slotState struct{ live, limit int }

func (s slotState) free() bool    { return s.live < s.limit }
func (s slotState) position() int { return s.live - s.limit + 1 }

// queuedLine is what a waiting run says once, so it never looks hung. It names
// the position, and the retry estimate when one can be quoted honestly.
func (o *Orchestrator) queuedLine(s slotState, caller domain.CallerKind, key string) string {
	position := s.position()
	line := fmt.Sprintf("haven: %d heavy runs already active (limit %d), queued at position %d",
		s.live, s.limit, position)
	if hint, ok := domain.NewRetryHint(position, o.store.ObservedDuration(key), caller); ok {
		line += " — " + hint.Describe()
	}
	return line
}

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

	waited, queued, err := o.waitForHeavySlot(ctx, caller, key)
	if err != nil {
		return err
	}

	release, err := o.store.ClaimHeavyRun(o.sys.Getpid(), r.Shell)
	if err != nil {
		// A slot we cannot record is a slot nobody else can see. Run anyway: a
		// miscounted slot is a far better outcome than a command that never runs.
		o.log.Warn("could not record the heavy-run claim; running uncounted")
		release = func() {}
	}
	defer release()

	// Only speak if we actually queued. On the happy path this command is
	// transparent — the wait is microseconds, and reporting "waited 0s" would
	// train the reader to ignore the line that matters.
	if queued {
		fmt.Printf("haven: waited %s for a heavy slot\n", waited.Round(time.Second))
	}

	started := o.sys.Now()
	// The inner script takes a machine-wide slot of its own. We already hold
	// one, so turn that gate off for this run: counting it twice would queue it
	// behind itself.
	err = o.sup.RunOnce(ctx, "heavy", r.Dir, r.Shell, []string{"CHECK_SLOTS=0", "HAVEN_SLOT_HELD=1"})
	o.store.ObserveDuration(key, o.sys.Now().Sub(started))
	return err
}

// waitForHeavySlot blocks until a slot frees or the ceiling is reached,
// reporting position so a queued run never looks hung.
//
// Reaching the ceiling proceeds anyway rather than failing. The ceiling exists
// to stop an agent idling past its cache floor, and a run that starts late is
// strictly better than one that never starts — a wedged queue must not be able
// to block work entirely.
func (o *Orchestrator) waitForHeavySlot(ctx context.Context, caller domain.CallerKind, key string) (waited time.Duration, queued bool, err error) {
	start := o.sys.Now()
	ceiling := caller.WaitCeiling()
	announced := false
	for {
		s := slotState{live: o.store.HeavyRuns(), limit: domain.HeavySlots(o.sys.MemStat(), runtime.NumCPU())}
		if s.free() {
			return o.sys.Now().Sub(start), announced, nil
		}

		waited := o.sys.Now().Sub(start)
		if waited >= ceiling {
			fmt.Printf("haven: no slot after %s, starting anyway (%d of %d busy)\n",
				waited.Round(time.Second), s.live, s.limit)
			return waited, true, nil
		}

		if !announced {
			announced = true
			fmt.Println(o.queuedLine(s, caller, key))
		}

		select {
		case <-ctx.Done():
			return o.sys.Now().Sub(start), true, ctx.Err()
		case <-time.After(heavyRunPoll):
		}
	}
}
