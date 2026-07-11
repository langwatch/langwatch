package domain

import "time"

// TypecheckReapLimits bound a single `haven typecheck` run so one runaway tsgo
// process can't sit on a slot forever or blow past the RAM budget TypecheckSlots
// assumed when it granted that slot. Either bound alone is enough to kill.
type TypecheckReapLimits struct {
	MaxRSSBytes int64         // 0 disables the memory check
	MaxDuration time.Duration // 0 disables the duration check
}

// DefaultTypecheckReapLimits sizes the RSS ceiling a little above the ~4 GiB
// TypecheckSlots already budgets per run — tsgo runs that stay under budget
// should never trip this; it exists for the run that doesn't. The duration
// ceiling is generous: a real tsgo run on this codebase finishes in well under
// 5 minutes; 10 catches a genuinely hung process without flagging a slow CI box.
func DefaultTypecheckReapLimits() TypecheckReapLimits {
	return TypecheckReapLimits{
		MaxRSSBytes: 6 << 30, // 6 GiB
		MaxDuration: 10 * time.Minute,
	}
}

// TypecheckSlots decides how many concurrent tsgo typechecks may run across all
// worktrees on this machine. A tsgo run is memory-hungry (~3-4 GiB peak on this
// codebase), so parallel `pnpm typecheck` across worktrees is what exhausts RAM.
// An explicit override wins; otherwise we bound by memory (one slot per ~4 GiB)
// and never exceed the CPU count. slots starts at 1, so at least one slot always.
func TypecheckSlots(totalRAMBytes uint64, numCPU, override int) int {
	if override > 0 {
		return override
	}
	const perRun = uint64(4) << 30 // 4 GiB budget per typecheck
	slots := 1
	if totalRAMBytes >= perRun {
		slots = int(totalRAMBytes / perRun)
	}
	if numCPU > 0 && slots > numCPU {
		slots = numCPU
	}
	return slots
}
