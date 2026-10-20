package domain

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// The machine-wide check queue (specs/setup/check-slots.feature). Whole-repo
// checks — a tsgo typecheck, a whole-tree lint — saturate the machine on purpose,
// and several worktrees' worth at once is what makes a laptop unusable. The
// queue used to live only in dev/scripts/check-queue.mjs; the decisions now
// live here so `haven machine slot run` (and `haven machine typecheck`) gate against the same
// counter with the same rules, and the JS wrapper delegates to haven when the
// binary is installed.

// checkRAMPerRun is the memory budget one whole-repo check is assumed to take
// when deriving the default limit from the machine.
const checkRAMPerRun = 6 << 30

// checkCPUsPerRun is how many cores a single check wants before a second one
// is worth starting.
const checkCPUsPerRun = 4

// CheckEnv carries the environment the limit is resolved from.
type CheckEnv struct {
	CheckSlots string // CHECK_SLOTS
	CI         string // CI
	Claudecode string // CLAUDECODE, set in every shell an agent runs
	// TestWorkers is HAVEN_TEST_WORKERS as haven resolves it (env, .env, settings).
	TestWorkers string
	// HeldByQueue reports that CHECK_QUEUE_HELD names a live ancestor of this
	// process that is itself one of the queue's wrappers: the queue spawned the
	// run and already counted it. The caller resolves it, because the domain
	// does not inspect processes.
	HeldByQueue bool
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
//
// CI reads green whatever the machine says. The queue already stands down
// there, and the same reasoning retires the pressure policy with it: a runner
// runs one job and nobody is typing on it, so halving its cores buys back an
// interactive machine that does not exist and only makes the job slower. A
// swap figure read inside a container describes the host, not this job. The
// level is measured on macOS only, so today CI is green by accident of the
// runner's kernel on a Linux runner and by this rule everywhere; the rule is
// what makes "CI is unaffected" true rather than lucky.
func ResolveCheckPressure(override string, measured Pressure, ci string) Pressure {
	switch strings.ToLower(strings.TrimSpace(override)) {
	case "green":
		return Green
	case "amber":
		return Amber
	case "red":
		return Red
	}
	if isTruthyEnv(ci) {
		return Green
	}
	return measured
}

// isTruthyEnv reads the CI convention: the variable is set to something that
// is not one of the values meaning "no". CI and CLAUDECODE both follow it, so
// the slot limit and the pressure policy read them by one rule that cannot
// drift apart.
func isTruthyEnv(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized != "" && normalized != "0" && normalized != "false"
}

// ResolveCheckSlots resolves how many whole-repo checks may run at once, and
// names where the answer came from ("CHECK_SLOTS", "held", "CI", "machine" or
// "pressure").
//
// An explicit CHECK_SLOTS always wins, including under CI — that is what lets
// tests exercise the queue on a CI runner. "0" (or off/none/unlimited/false)
// disables the gate — from a person's shell. From an agent shell (CLAUDECODE
// set) a gate-off is ignored and the derived limit applies, unless the queue
// itself spawned the run (HeldByQueue): the queue exists to serialize agents,
// so a lever any agent may pull is not a limit. Unset, CI gets no queue at all
// (one job runs one check), and a developer machine gets a limit bounded by
// both memory and cores — tsgo is memory-hungry AND parallel, so the tighter
// bound is the honest one — never below 1, or the queue would deadlock every
// run.
//
// A machine already under memory pressure gets one slot, whatever the formula
// says. The formula assumes an otherwise idle machine, and pressure is the
// machine reporting that assumption false: its RAM is spoken for, so a second
// concurrent check is paid for in everyone's swap. Only the derived default
// narrows. An explicit CHECK_SLOTS is the operator's call either way.
func ResolveCheckSlots(machine CheckMachine, env CheckEnv) (int, string) {
	raw := strings.TrimSpace(env.CheckSlots)
	if raw != "" {
		if gateOffRequested(raw) {
			if !isTruthyEnv(env.Claudecode) {
				return 0, "CHECK_SLOTS"
			}
			if env.HeldByQueue {
				return 0, "held"
			}
			// An agent shell may not turn the queue off: fall through to the
			// derived limit as if CHECK_SLOTS were unset.
		} else if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			return parsed, "CHECK_SLOTS"
		}
		// An unparseable value falls through to the derived default, exactly
		// like the JS wrapper: a typo must not turn the gate off.
	}
	if isTruthyEnv(env.CI) {
		return 0, "CI"
	}
	if machine.Pressure > Green {
		return 1, "pressure"
	}
	byMemory := int(machine.TotalRAMBytes / checkRAMPerRun)
	byCPU := machine.NumCPU / checkCPUsPerRun
	return max(1, min(byMemory, byCPU)), "machine"
}

// gateOffRequested reads the values that ask for the queue to be off entirely.
func gateOffRequested(raw string) bool {
	switch strings.ToLower(raw) {
	case "off", "none", "unlimited", "false":
		return true
	}
	parsed, err := strconv.Atoi(raw)
	return err == nil && parsed == 0
}

// GateOffIgnored reports that this environment asked for the gate to be off
// and was refused: the ask came from an agent shell and not from the queue
// itself. ResolveCheckSlots stays silent about it, so callers use this to say
// why the limit still applies.
func GateOffIgnored(env CheckEnv) bool {
	return gateOffRequested(strings.TrimSpace(env.CheckSlots)) &&
		isTruthyEnv(env.Claudecode) && !env.HeldByQueue
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
// wraps: the units the run holds, on every machine (D2 in
// dev/docs/plans/haven-exec-policy.md). A run counted as two units that
// spreads over every core makes the budget a lie. An operator's explicit
// GOMAXPROCS always wins.
func CheckGoMaxProcs(units int, existing string) string {
	if existing != "" {
		return existing
	}
	return strconv.Itoa(max(1, units))
}

// SlotClass names the kind of run on the check budget; each class has a weight
// in core units (dev/docs/plans/haven-exec-policy.md, section 4).
type SlotClass string

const (
	// ClassCheck is a run that names no class: one whole-repo check, as before.
	ClassCheck SlotClass = "check"
	// ClassTypecheck is a tsc run (two units).
	ClassTypecheck SlotClass = "typecheck"
	// ClassTest is a Vitest run (its worker count in units).
	ClassTest SlotClass = "test"
	// ClassLint is an oxlint or tsgolint run (two units).
	ClassLint SlotClass = "lint"
	// ClassBuild is a vite or build:types run (two units).
	ClassBuild SlotClass = "build"
)

// ParseSlotClass reads --class; empty is ClassCheck.
func ParseSlotClass(raw string) (SlotClass, error) {
	switch class := SlotClass(strings.ToLower(strings.TrimSpace(raw))); class {
	case "", ClassCheck:
		return ClassCheck, nil
	case ClassTypecheck, ClassTest, ClassLint, ClassBuild:
		return class, nil
	}
	return "", fmt.Errorf("--class %q: want typecheck, test, lint or build", raw)
}

const (
	// checkUnitsPerCheck is the weight of one check: typecheck, lint, build and
	// a run with no class all take two cores.
	checkUnitsPerCheck = 2
	// testUnitsMax caps a test run's weight, whatever its worker count.
	testUnitsMax = 4
	// checkCoresReserved stay with the person at the keyboard.
	checkCoresReserved = 2
	// checkRAMPerUnit keeps a unit's memory share the same as a check's half.
	checkRAMPerUnit = checkRAMPerRun / checkUnitsPerCheck
)

// SlotWeight is how many core units a run of class takes: a test run takes its
// Vitest worker count (two unless VITEST_MAX_WORKERS says otherwise, at most
// four), every other class takes one check's two.
func SlotWeight(class SlotClass, vitestMaxWorkers string) int {
	if class != ClassTest {
		return checkUnitsPerCheck
	}
	workers, err := strconv.Atoi(strings.TrimSpace(vitestMaxWorkers))
	if err != nil || workers < 1 {
		return checkUnitsPerCheck
	}
	return min(workers, testUnitsMax)
}

// CheckVitestWorkers is VITEST_MAX_WORKERS for a run holding units: a test run
// gets its units, and an operator's value only up to them, so a red budget
// never runs four workers on two units. Other classes keep what they had.
func CheckVitestWorkers(class SlotClass, units int, existing string) string {
	if class != ClassTest {
		return existing
	}
	units = max(1, units)
	if asked, err := strconv.Atoi(strings.TrimSpace(existing)); err == nil && asked >= 1 {
		return strconv.Itoa(min(asked, units))
	}
	return strconv.Itoa(units)
}

// UnitsPerCheck is the weight of one check that names no class, and of each
// run the gate and `haven machine typecheck` admit.
const UnitsPerCheck = checkUnitsPerCheck

// SlotClaim is who holds part of the check budget: written into each lock file
// a run holds and into its waiter and holder records, so explain and status can
// name the class, units, worktree and pid behind every unit.
type SlotClaim struct {
	PID       int       `json:"pid"`
	Class     string    `json:"class"`
	Units     int       `json:"units"`
	Worktree  string    `json:"worktree,omitempty"`
	Label     string    `json:"label,omitempty"`
	StartedAt time.Time `json:"startedAt"`
}

// ResolveCheckUnits is the machine-wide budget in core units, ADR-090's one
// counter (D1). It follows ResolveCheckSlots for an explicit CHECK_SLOTS, the
// gate-off and CI, one check being two units; derived, it is the cores less two
// (bounded by memory) when green, half under amber, a quarter under red, and
// never below one check.
func ResolveCheckUnits(machine CheckMachine, env CheckEnv) (int, string) {
	slots, source := ResolveCheckSlots(machine, env)
	if source != "machine" && source != "pressure" {
		return slots * checkUnitsPerCheck, source
	}
	green := min(machine.NumCPU-checkCoresReserved, int(machine.TotalRAMBytes/checkRAMPerUnit))
	switch machine.Pressure {
	case Amber:
		return max(checkUnitsPerCheck, green/2), source
	case Red:
		return max(checkUnitsPerCheck, green/4), source
	default:
		return max(checkUnitsPerCheck, green), source
	}
}

// QueueTieWindow is how much earlier a same-priority waiter must have queued to
// be served first: one poll tick, inside which arrivals race as before.
const QueueTieWindow = 100 * time.Millisecond

// WaitBehind reports that self should let this tick pass: another waiter has a
// higher priority, or the same priority and queued first. The second rule is
// what stops a stream of two-unit runs starving a four-unit run at the head.
func WaitBehind(self WaiterState, others []WaiterState) bool {
	if ShouldYield(self, others) {
		return true
	}
	mine := self.Priority()
	for _, other := range others {
		if other.Priority() == mine && other.Waited-self.Waited >= QueueTieWindow {
			return true
		}
	}
	return false
}
