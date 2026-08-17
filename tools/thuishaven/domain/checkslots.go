package domain

import (
	"fmt"
	"strconv"
	"strings"
)

// The machine-wide check queue (specs/setup/check-slots.feature). Whole-repo
// checks — a tsgo typecheck, a biome lint — saturate the machine on purpose,
// and several worktrees' worth at once is what makes a laptop unusable. The
// queue used to live only in dev/scripts/check-queue.mjs; the decisions now
// live here so `haven slot run` (and `haven typecheck`) gate against the same
// counter with the same rules, and the JS wrapper delegates to haven when the
// binary is installed.

// checkRAMPerRun is the memory budget one whole-repo check is assumed to take
// when deriving the default limit from the machine.
const checkRAMPerRun = 6 << 30

// checkCPUsPerRun is how many cores a single check wants before a second one
// is worth starting.
const checkCPUsPerRun = 4

// CheckEnv carries the two environment values the limit is resolved from.
type CheckEnv struct {
	CheckSlots string // CHECK_SLOTS
	CI         string // CI
}

// ResolveCheckSlots resolves how many whole-repo checks may run at once, and
// names where the answer came from ("CHECK_SLOTS", "CI" or "machine").
//
// An explicit CHECK_SLOTS always wins, including under CI — that is what lets
// tests exercise the queue on a CI runner. "0" (or off/none/unlimited/false)
// disables the gate. Unset, CI gets no queue at all (one job runs one check),
// and a developer machine gets a limit bounded by both memory and cores —
// tsgo is memory-hungry AND parallel, so the tighter bound is the honest one —
// never below 1, or the queue would deadlock every run.
func ResolveCheckSlots(totalRAMBytes uint64, numCPU int, env CheckEnv) (int, string) {
	raw := strings.TrimSpace(env.CheckSlots)
	if raw != "" {
		switch strings.ToLower(raw) {
		case "off", "none", "unlimited", "false":
			return 0, "CHECK_SLOTS"
		}
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			return parsed, "CHECK_SLOTS"
		}
		// An unparseable value falls through to the derived default, exactly
		// like the JS wrapper: a typo must not turn the gate off.
	}
	ci := strings.ToLower(strings.TrimSpace(env.CI))
	if ci != "" && ci != "0" && ci != "false" {
		return 0, "CI"
	}
	byMemory := int(totalRAMBytes / checkRAMPerRun)
	byCPU := numCPU / checkCPUsPerRun
	return max(1, min(byMemory, byCPU)), "machine"
}

// CheckGoMemLimit is the soft memory cap set on the Go-runtime tools the queue
// wraps (the TypeScript compiler is a Go binary): GOMEMLIMIT makes the runtime
// collect harder to stay under the limit instead of ballooning (ADR-095). The
// daemon's process watch is the hard backstop above this.
//
// Half the machine, clamped to [3, 6] GiB; an operator's explicit GOMEMLIMIT
// always wins. The old cap of 10 was not a limit anything reached by accident:
// GOMEMLIMIT is a soft ceiling the runtime expands toward, so an 18 GiB laptop
// resolved to 9 GiB and a typecheck duly footprinted 9.08 GB against a 2.29 GB
// working set. Measured at four ceilings the working set stayed inside
// 2.3-3.5 GB every time, so 6 cannot be what constrains it. The floor is 3
// rather than lower because a ceiling below the live heap is missed anyway, at
// the price of collecting continuously to miss it. 6 itself is a judgement
// between measured points and wants a re-measure on an unloaded machine; see
// ADR-099, which records what the samples do and do not establish.
func CheckGoMemLimit(totalRAMBytes uint64, existing string) string {
	if existing != "" {
		return existing
	}
	gib := int(totalRAMBytes / (2 << 30))
	return fmt.Sprintf("%dGiB", clampInt(gib, 3, 6))
}
