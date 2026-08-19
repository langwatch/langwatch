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

// CheckMachine carries the machine facts the limit is resolved from.
type CheckMachine struct {
	TotalRAMBytes uint64
	NumCPU        int
	Pressure      Pressure
}

// ResolveCheckPressure reads the CHECK_PRESSURE override, falling back to what
// the machine measured. The override exists for two reasons that are really
// one: tests need a deterministic level, and an operator who knows better than
// the heuristic (a machine that is about to get busy, or one whose swap is
// disabled for a good reason) needs the same lever. A value that is not one of
// the three level names falls back to the measurement, exactly like a
// CHECK_SLOTS typo: a misspelling must not change the policy.
func ResolveCheckPressure(override string, measured Pressure) Pressure {
	switch strings.ToLower(strings.TrimSpace(override)) {
	case "green":
		return Green
	case "amber":
		return Amber
	case "red":
		return Red
	default:
		return measured
	}
}

// ResolveCheckSlots resolves how many whole-repo checks may run at once, and
// names where the answer came from ("CHECK_SLOTS", "CI", "machine" or
// "pressure").
//
// An explicit CHECK_SLOTS always wins, including under CI — that is what lets
// tests exercise the queue on a CI runner. "0" (or off/none/unlimited/false)
// disables the gate. Unset, CI gets no queue at all (one job runs one check),
// and a developer machine gets a limit bounded by both memory and cores —
// tsgo is memory-hungry AND parallel, so the tighter bound is the honest one —
// never below 1, or the queue would deadlock every run.
//
// A machine already under memory pressure gets one slot, whatever the formula
// says. The formula assumes an otherwise idle machine, and pressure is the
// machine reporting that assumption false: its RAM is spoken for, so a second
// concurrent check is paid for in everyone's swap. Only the derived default
// narrows — an explicit CHECK_SLOTS is the operator's call either way.
func ResolveCheckSlots(machine CheckMachine, env CheckEnv) (int, string) {
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
	if machine.Pressure > Green {
		return 1, "pressure"
	}
	byMemory := int(machine.TotalRAMBytes / checkRAMPerRun)
	byCPU := machine.NumCPU / checkCPUsPerRun
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
// ADR-100, which records what the samples do and do not establish.
//
// A machine under memory pressure gets the floor outright. The ceiling is
// garbage the runtime has not collected because it was told there was room;
// on a machine that is already compressing and swapping there is no room, and
// every gigabyte the ceiling grants is paid by evicting someone else's pages.
// The floor trades that for the run's own GC time, which is the trade a
// pressured machine wants: the check pays, not everything else.
func CheckGoMemLimit(totalRAMBytes uint64, existing string, pressure Pressure) string {
	if existing != "" {
		return existing
	}
	if pressure > Green {
		return "3GiB"
	}
	gib := int(totalRAMBytes / (2 << 30))
	return fmt.Sprintf("%dGiB", clampInt(gib, 3, 6))
}

// CheckGoMaxProcs is the parallelism the queue grants the Go-runtime tools it
// wraps. On a green machine it grants nothing — an empty string means "do not
// set it" and the tool uses every core, which is the right spend for one run
// on an idle machine. Under pressure it halves the cores, never below two:
// eleven runnable threads on a machine that has to page every allocation in
// is eleven threads taking page faults, and half of them buys back an
// interactive machine for a modest wall-clock cost. An operator's explicit
// GOMAXPROCS always wins, whatever the level.
func CheckGoMaxProcs(numCPU int, existing string, pressure Pressure) string {
	if existing != "" {
		return existing
	}
	if pressure == Green {
		return ""
	}
	return strconv.Itoa(max(2, numCPU/2))
}
