package app

import (
	"context"
	"fmt"
	"runtime"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Typecheck runs `pnpm typecheck` (tsgo) under a machine-wide slot so parallel
// typechecks across worktrees can't exhaust RAM. It blocks until a slot is free,
// runs, and releases — a thin, well-behaved wrapper any script can call in place
// of `pnpm typecheck`. extraArgs are forwarded to the underlying command.
// maxRSSOverrideMB <= 0 keeps domain.DefaultTypecheckReapLimits' RSS ceiling
// (env parsing is composition-root-only, so this comes in as a resolved value,
// same as slotsOverride).
func (o *Orchestrator) Typecheck(ctx context.Context, lwDir string, extraArgs []string, slotsOverride, maxRSSOverrideMB int) error {
	if o.sem == nil {
		return fmt.Errorf("semaphore not wired")
	}
	slots := domain.TypecheckSlots(o.sys.TotalMemory(), runtime.NumCPU(), slotsOverride)
	release, slot, err := o.sem.Acquire(ctx, "typecheck", slots)
	if err != nil {
		return err
	}
	defer release()
	if !o.cfg.IsAgent {
		fmt.Printf("\x1b[2mhaven: typecheck slot %d/%d\x1b[0m\n", slot, slots)
	} else {
		fmt.Printf("haven: typecheck slot %d/%d\n", slot, slots)
	}
	shell := "pnpm typecheck"
	for _, a := range extraArgs {
		shell += " " + a
	}
	rl := domain.DefaultTypecheckReapLimits()
	if maxRSSOverrideMB > 0 {
		rl.MaxRSSBytes = int64(maxRSSOverrideMB) << 20
	}
	return o.sup.RunOnceBounded(ctx, "typecheck", lwDir, shell, nil, ReapLimits(rl))
}
