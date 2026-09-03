package app

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Typecheck runs `pnpm typecheck` (tsgo) under a machine-wide slot so parallel
// typechecks across worktrees can't exhaust RAM. It blocks until a slot is free,
// runs, and releases — a thin, well-behaved wrapper any script can call in place
// of `pnpm typecheck`. extraArgs are forwarded to the underlying command.
// maxRSSOverrideMB <= 0 keeps domain.DefaultTypecheckReapLimits' RSS ceiling
// (env parsing is composition-root-only, so this comes in as a resolved value,
// same as slotsOverride).
func (o *Orchestrator) Typecheck(ctx context.Context, repoDir string, extraArgs []string, slotsOverride, maxRSSOverrideMB int) error {
	if o.sem == nil {
		return fmt.Errorf("semaphore not wired")
	}
	slots := domain.TypecheckSlots(o.sys.TotalMemory(), runtime.NumCPU(), slotsOverride)
	// "checks" is the same semaphore `haven slot run` (and through it every
	// delegated `pnpm typecheck` / `pnpm lint` on the machine) counts against:
	// one counter for everything that saturates the cores, ADR-064 + ADR-095.
	release, slot, err := o.sem.Acquire(ctx, "checks", slots)
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
		shell += " " + shellQuote(a)
	}
	rl := domain.DefaultTypecheckReapLimits()
	if maxRSSOverrideMB > 0 {
		rl.MaxRSSBytes = int64(maxRSSOverrideMB) << 20
	}
	// The `typecheck` script takes a machine-wide slot of its own
	// (dev/scripts/check-queue.mjs). We already hold one here, so turn that
	// gate off for this run: counting it twice would queue it behind itself, and
	// the reaper's duration ceiling would then be spent waiting rather than
	// typechecking. The pid marker is what agent shells honor, and it only
	// convinces a descendant.
	env := []string{"CHECK_SLOTS=0", "CHECK_QUEUE_HELD=" + strconv.Itoa(os.Getpid())}
	return o.sup.RunOnceBounded(ctx, "typecheck", repoDir, shell, env, ReapLimits(rl))
}

// shellQuote single-quotes s for safe interpolation into a `bash -lc` string,
// escaping any embedded single quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}
