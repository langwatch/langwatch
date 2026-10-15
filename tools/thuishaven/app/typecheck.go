package app

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// TypecheckRun is one `haven machine typecheck`. ExtraArgs are forwarded to the
// underlying command. MaxRSSOverrideMB <= 0 keeps domain.DefaultTypecheckReapLimits'
// RSS ceiling (env parsing is composition-root-only, so this comes in as a
// resolved value, same as SlotsOverride).
type TypecheckRun struct {
	RepoDir          string
	ExtraArgs        []string
	SlotsOverride    int
	MaxRSSOverrideMB int
	// Affected is accepted for the CLI's --affected and runs the same root
	// `tsc -b`, which re-checks only what changed (ADR-150, 2026-10-10).
	Affected bool
}

// Typecheck runs `pnpm typecheck` under a machine-wide slot so parallel
// typechecks can't exhaust RAM; nothing below re-queues (CHECK_QUEUE_HELD).
// Per-project Nx typecheck is gone: one tsc per project re-checks each closure.
func (o *Orchestrator) Typecheck(ctx context.Context, r TypecheckRun) error {
	if o.sem == nil {
		return fmt.Errorf("semaphore not wired")
	}
	units := o.checkUnits()
	if r.SlotsOverride > 0 {
		units = r.SlotsOverride * domain.UnitsPerCheck
	}
	release, err := o.holdTypecheckSlot(ctx, units)
	if err != nil {
		return err
	}
	defer release()
	note := fmt.Sprintf("haven: typecheck holds %d of %d check units", domain.UnitsPerCheck, units)
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
	for _, a := range r.ExtraArgs {
		shell += " " + shellQuote(a)
	}
	return o.sup.RunOnceBounded(ctx, "typecheck", r.RepoDir, shell, env, ReapLimits(rl))
}

// holdTypecheckSlot waits for two units of the "checks" budget, the counter
// `haven machine slot run` shares (ADR-064, ADR-095). budget == 0 is the gate off.
func (o *Orchestrator) holdTypecheckSlot(ctx context.Context, budget int) (release func(), err error) {
	if budget <= 0 {
		return func() {}, nil
	}
	return o.acquireUnits(ctx, budget, o.checkClaim(domain.ClassTypecheck, "haven machine typecheck"))
}

// takeFreeCheckSlots takes up to n more two-unit checks of the budget that are
// free right now, without waiting, and returns how many it got plus their release.
func (o *Orchestrator) takeFreeCheckSlots(budget, n int) (release func(), got int) {
	var releases []func()
	for range n {
		rel, ok, err := o.sem.TryAcquireUnits("checks", budget, o.checkClaim(domain.ClassCheck, "nx parallel probe"))
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
	units := o.checkUnits()
	if units == 0 {
		return nil
	}
	release, free := o.takeFreeCheckSlots(units, max(1, units/domain.UnitsPerCheck))
	release()
	return []string{"NX_PARALLEL=" + strconv.Itoa(max(1, free))}
}

// shellQuote single-quotes s for safe interpolation into a `bash -lc` string,
// escaping any embedded single quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}
