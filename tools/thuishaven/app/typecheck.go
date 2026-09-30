package app

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// TypecheckRun is one `haven typecheck`. ExtraArgs are forwarded to the
// underlying command. MaxRSSOverrideMB <= 0 keeps domain.DefaultTypecheckReapLimits'
// RSS ceiling (env parsing is composition-root-only, so this comes in as a
// resolved value, same as SlotsOverride).
type TypecheckRun struct {
	RepoDir          string
	ExtraArgs        []string
	SlotsOverride    int
	MaxRSSOverrideMB int
	Affected         bool
}

// Typecheck runs `pnpm typecheck` under a machine-wide slot so parallel
// typechecks can't exhaust RAM. Affected runs `nx affected -t typecheck` from
// the merge-base instead, holding every check slot free right now (at least
// one) and telling Nx that count in NX_PARALLEL: one counted slot per parallel
// tsc, and nothing below re-queues (CHECK_QUEUE_HELD).
func (o *Orchestrator) Typecheck(ctx context.Context, r TypecheckRun) error {
	affected := r.Affected
	if o.sem == nil {
		return fmt.Errorf("semaphore not wired")
	}
	slots := o.checkSlots()
	if r.SlotsOverride > 0 {
		slots = r.SlotsOverride
	}
	release, slot, parallel, err := o.holdTypecheckSlots(ctx, slots, affected)
	if err != nil {
		return err
	}
	defer release()
	note := fmt.Sprintf("haven: typecheck slot %d/%d", slot, slots)
	if affected {
		note += fmt.Sprintf(", --affected with NX_PARALLEL=%d", parallel)
	}
	if !o.cfg.IsAgent {
		note = "\x1b[2m" + note + "\x1b[0m"
	}
	fmt.Println(note)
	rl := domain.DefaultTypecheckReapLimits()
	if r.MaxRSSOverrideMB > 0 {
		rl.MaxRSSBytes = int64(r.MaxRSSOverrideMB) << 20
	}
	// Nested explicit Haven commands recognize this owner instead of taking
	// another slot behind the one this process already holds.
	env := []string{"CHECK_SLOTS=0", "CHECK_QUEUE_HELD=" + strconv.Itoa(os.Getpid())}
	shell := "pnpm typecheck"
	if affected {
		// The ceiling is per slot, and this run holds `parallel` of them.
		rl.MaxRSSBytes *= int64(parallel)
		env = append(env, "NX_PARALLEL="+strconv.Itoa(parallel))
		shell = affectedTypecheckShell
	}
	for _, a := range r.ExtraArgs {
		shell += " " + shellQuote(a)
	}
	return o.sup.RunOnceBounded(ctx, "typecheck", r.RepoDir, shell, env, ReapLimits(rl))
}

// holdTypecheckSlots waits for one "checks" slot, the counter `haven slot run`
// shares (ADR-064, ADR-095), and for an affected run takes every other slot
// free right now too. slots == 0 is the gate turned off.
func (o *Orchestrator) holdTypecheckSlots(ctx context.Context, slots int, affected bool) (release func(), slot, parallel int, err error) {
	if slots <= 0 {
		return func() {}, 0, 1, nil
	}
	first, slot, err := o.sem.Acquire(ctx, "checks", slots)
	if err != nil {
		return nil, 0, 0, err
	}
	if !affected {
		return first, slot, 1, nil
	}
	more, n := o.takeFreeCheckSlots(slots, slots-1)
	return func() { more(); first() }, slot, 1 + n, nil
}

// affectedTypecheckShell typechecks what changed since this branch left its
// upstream, or origin/main when it has none (a detached worktree).
const affectedTypecheckShell = `pnpm exec nx affected -t typecheck --base="$(git merge-base HEAD '@{upstream}' 2>/dev/null || git merge-base HEAD origin/main)" --head=HEAD`

// takeFreeCheckSlots takes up to n more of the pool's check slots that are
// free right now, without waiting, and returns how many it got plus their release.
func (o *Orchestrator) takeFreeCheckSlots(pool, n int) (release func(), got int) {
	var releases []func()
	for range n {
		rel, _, ok, err := o.sem.TryAcquire("checks", pool)
		if err != nil || !ok {
			break
		}
		releases = append(releases, rel)
	}
	return func() {
		for _, rel := range releases {
			rel()
		}
	}, len(releases)
}

// nxParallelEnv caps Nx at the check slots free right now, at least one, for a
// lane haven runs that holds no slot itself (codegen): it starts no more tasks
// than the machine has room for. Nil when the check gate is off.
func (o *Orchestrator) nxParallelEnv() []string {
	if o.sem == nil {
		return nil
	}
	slots := o.checkSlots()
	if slots == 0 {
		return nil
	}
	release, free := o.takeFreeCheckSlots(slots, slots)
	release()
	return []string{"NX_PARALLEL=" + strconv.Itoa(max(1, free))}
}

// shellQuote single-quotes s for safe interpolation into a `bash -lc` string,
// escaping any embedded single quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}
