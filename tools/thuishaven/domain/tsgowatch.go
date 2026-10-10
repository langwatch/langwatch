package domain

import (
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The TypeScript compiler governor (ADR-095). The compiler is the single
// largest transient memory consumer on a dev machine, and admission controls
// only see the spawns they wrap. This is the other half: policy over a sample
// of every live compiler process, wherever it came from. The decisions here
// are pure; the daemon samples and enforces.
//
// The types keep the Tsgo name the governor was born with, because the knobs
// (HAVEN_TSGO_*), the metric attribute and the persisted reap Kind are all
// spelled that way and are a contract with machines that already carry
// history. What the governor SELECTS is name-neutral: see
// typeScriptCompilerBinaries.

// TsgoClass is the crude-on-purpose classification: an --lsp instance is a
// language server, anything else is a run. Single-file checks are tiny and
// never cross a threshold, so telling them apart from whole-tree runs buys
// nothing.
type TsgoClass string

// The two classes: a compile run (whole-tree or targeted) and a long-lived
// --lsp language server.
const (
	TsgoRun TsgoClass = "run"
	TsgoLSP TsgoClass = "lsp"
)

// TsgoProcess is one live tsgo process as sampled by the daemon.
type TsgoProcess struct {
	PID     int
	Class   TsgoClass
	RSS     int64 // bytes
	Started time.Time
	// IdleFor is how long the process's CPU clock has not moved, tracked by
	// the sampler across ticks. Zero means it was active at the last tick (or
	// has not been observed long enough to know).
	IdleFor time.Duration
}

// typeScriptCompilerBinaries are the names the native TypeScript compiler is
// installed under. They are one binary under two package identities:
// @typescript/native-preview published it as `tsgo`, and typescript@7 renamed
// it to `tsc` — the package picks the name (`lib/getExePath.js`:
// `baseName === "typescript" ? "tsc" : "tsgo"`), and a local repo build still
// produces `tsgo`, so both names stay live on real machines. One compiler is
// one class with one set of limits: two classes would split the machine budget
// in half and govern neither half of it.
var typeScriptCompilerBinaries = []string{"tsc", "tsgo"}

// TypeScriptCompilerClass is the single process class both compiler binaries
// land in. Deliberately still spelled "tsgo" after the rename: the string is
// the `class` attribute on every haven_proc_* series, the Kind of a persisted
// reap event, and the key the daemon selects the governed subset by — renaming
// it would cut the recorded history in two at exactly the moment the point of
// the change is to join the two binaries together.
const TypeScriptCompilerClass = "tsgo"

// IsTypeScriptCompilerCommand reports whether a process command line invokes
// the native TypeScript compiler under either of its names — the whole
// selection rule, so the governor can never touch anything else. Matched on
// the binary path, not the args: an unrelated process mentioning "tsc" or
// "tsgo" in an argument is not a candidate, and neither is the `tsc.real` /
// `tsgo.real` launcher the check-queue shim runs, which is a shell and then a
// node process — the compiler it finally becomes is the process governed.
func IsTypeScriptCompilerCommand(command string) bool {
	return isTypeScriptCompilerBinary(binaryBase(command))
}

// isTypeScriptCompilerBinary reports whether a binary base name is the
// compiler's, under either name.
func isTypeScriptCompilerBinary(base string) bool {
	return slices.Contains(typeScriptCompilerBinaries, base)
}

// ClassifyTsgo reads the class off a compiler command line. Arg-based, so it
// reads the same under either binary name.
func ClassifyTsgo(command string) TsgoClass {
	if strings.Contains(command, "--lsp") {
		return TsgoLSP
	}
	return TsgoRun
}

// binaryBase is the base name of a command line's binary — the first token's
// last path segment.
func binaryBase(command string) string {
	bin, _, _ := strings.Cut(strings.TrimSpace(command), " ")
	if i := strings.LastIndexByte(bin, '/'); i >= 0 {
		bin = bin[i+1:]
	}
	return bin
}

// WatchedProcess is one process of a class haven observes over time — the
// facts behind the dev-tooling dashboards and, for classes with limits, the
// governor's decisions.
type WatchedProcess struct {
	Class   string
	Role    TsgoClass // run|lsp — meaningful for compiler-shaped classes, "run" otherwise
	PID     int
	RSS     int64
	Started time.Time
	IdleFor time.Duration
}

// ClassifyWatchedProcess maps a command line to the process class haven
// tracks, or ok=false for everything haven has no interest in. The class list
// is deliberately the dev-tooling that shapes machine health: compilers and
// checkers (the TypeScript compiler under either name, gopls, oxlint), test
// workers (vitest — matched on the worker path, the same marker the orphan
// sweep uses), the JS runtimes every dev server and script runs on (node,
// bun), and coding agents (claude). Only the TypeScript compiler carries kill
// limits (ADR-095); every other class is observe-only — node and claude in
// particular are the user's own work and are never touched.
//
// `tsc` and `tsgo` return the SAME class, so limits, dashboards and reap
// events aggregate the one compiler into one budget however it was installed.
func ClassifyWatchedProcess(command string) (WatchedProcess, bool) {
	base := binaryBase(command)
	if isTypeScriptCompilerBinary(base) {
		return WatchedProcess{Class: TypeScriptCompilerClass, Role: ClassifyTsgo(command)}, true
	}
	switch base {
	case "gopls":
		return WatchedProcess{Class: "gopls", Role: TsgoLSP}, true
	case "oxlint":
		return WatchedProcess{Class: "oxlint", Role: TsgoRun}, true
	case "claude":
		return WatchedProcess{Class: "claude", Role: TsgoRun}, true
	case "bun":
		return WatchedProcess{Class: "bun", Role: TsgoRun}, true
	case "node":
		if strings.Contains(command, "vitest") {
			return WatchedProcess{Class: "vitest", Role: TsgoRun}, true
		}
		return WatchedProcess{Class: "node", Role: TsgoRun}, true
	}
	return WatchedProcess{}, false
}

// TsgoLimits bound what tsgo may take from the machine. Zero disables the
// individual rule; RunMaxRSS == 0 disables the governor entirely.
type TsgoLimits struct {
	RunMaxRSS   int64         // hard per-run ceiling; a run above it is runaway
	LSPMaxRSS   int64         // per-LSP ceiling; eviction costs a reconnect, not work
	LSPIdleTTL  time.Duration // evict an LSP whose CPU clock has not moved this long
	TotalBudget int64         // ceiling for all tsgo combined
}

// DefaultTsgoLimits sizes the governor against the machine. The per-run
// ceiling sits above the observed legitimate peak (a whole-tree
// typecheck:tests run reaches ~10 GiB), so it only fires on runaways; the
// aggregate budget (two thirds of RAM, never below the per-run ceiling) is
// what stops two legitimate runs from taking the machine together.
func DefaultTsgoLimits(totalRAMBytes uint64) TsgoLimits {
	budget := int64(totalRAMBytes) * 2 / 3
	const runMax = 12 << 30
	if budget < runMax {
		budget = runMax
	}
	return TsgoLimits{
		RunMaxRSS:   runMax,
		LSPMaxRSS:   4 << 30,
		LSPIdleTTL:  45 * time.Minute,
		TotalBudget: budget,
	}
}

// ParsePSDuration parses the `[[dd-]hh:]mm:ss[.cc]` shape ps prints for both
// cputime and etime ("01-04:06:44", "05:38:38", "4:47.17", "52.46"). ok=false
// for anything else — a sampler must never guess at a duration it will make a
// kill decision from.
func ParsePSDuration(s string) (time.Duration, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	days, s, ok := cutPSDays(s)
	if !ok {
		return 0, false
	}
	fraction, s, ok := cutPSFraction(s)
	if !ok {
		return 0, false
	}
	clock, ok := parsePSClock(s)
	if !ok {
		return 0, false
	}
	return time.Duration(days)*24*time.Hour + clock + fraction, true
}

// cutPSDays strips the optional leading "dd-" prefix.
func cutPSDays(s string) (days int64, rest string, ok bool) {
	before, after, found := strings.Cut(s, "-")
	if !found {
		return 0, s, true
	}
	n, err := strconv.ParseInt(before, 10, 64)
	if err != nil || n < 0 {
		return 0, "", false
	}
	return n, after, true
}

// cutPSFraction strips the optional trailing ".cc" centiseconds.
func cutPSFraction(s string) (fraction time.Duration, rest string, ok bool) {
	before, after, found := strings.Cut(s, ".")
	if !found {
		return 0, s, true
	}
	n, err := strconv.ParseInt(after, 10, 64)
	if err != nil || n < 0 || len(after) == 0 || len(after) > 2 {
		return 0, "", false
	}
	for i := len(after); i < 2; i++ {
		n *= 10
	}
	return time.Duration(n) * 10 * time.Millisecond, before, true
}

// parsePSClock parses the "[[hh:]mm:]ss" colon groups.
func parsePSClock(s string) (time.Duration, bool) {
	parts := strings.Split(s, ":")
	if len(parts) > 3 {
		return 0, false
	}
	var total time.Duration
	for _, p := range parts {
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil || n < 0 {
			return 0, false
		}
		total = total*60 + time.Duration(n)*time.Second
	}
	return total, true
}

// TsgoKill is one enforcement decision, with the reason it carries into the log.
type TsgoKill struct {
	PID     int
	Class   TsgoClass
	RSS     int64
	Started time.Time
	Reason  string
}

// GovernTsgo decides what to reclaim from a sample of live tsgo processes.
//
// Order of rules: hard per-process ceilings and idle eviction first (those
// processes are gone regardless of the total), then the aggregate budget over
// whatever survives — idle LSPs are already gone by then, so the budget
// reclaims the youngest runs first (the oldest is closest to finishing) until
// the remainder fits.
func GovernTsgo(procs []TsgoProcess, l TsgoLimits) []TsgoKill {
	if l.RunMaxRSS <= 0 {
		return nil
	}
	var kills []TsgoKill
	var survivors []TsgoProcess
	for _, p := range procs {
		if reason, over := overOwnLimit(p, l); over {
			kills = append(kills, TsgoKill{PID: p.PID, Class: p.Class, RSS: p.RSS, Started: p.Started, Reason: reason})
		} else {
			survivors = append(survivors, p)
		}
	}
	if l.TotalBudget > 0 {
		kills = append(kills, reclaimOverBudget(survivors, l.TotalBudget)...)
	}
	return kills
}

// overOwnLimit is the per-process rule: the reason a process is reclaimed on
// its own, independent of the aggregate budget.
func overOwnLimit(p TsgoProcess, l TsgoLimits) (string, bool) {
	switch {
	case p.Class == TsgoRun && p.RSS > l.RunMaxRSS:
		return "run exceeds the per-run memory ceiling", true
	case p.Class == TsgoLSP && l.LSPMaxRSS > 0 && p.RSS > l.LSPMaxRSS:
		return "language server exceeds its memory ceiling", true
	case p.Class == TsgoLSP && l.LSPIdleTTL > 0 && p.IdleFor >= l.LSPIdleTTL:
		return "language server idle past the eviction period", true
	}
	return "", false
}

// reclaimOverBudget stops the youngest surviving runs until the remainder
// fits the budget. Surviving LSPs are active and stay — an active LSP is
// somebody's editor session, and the budget pressure is almost always a run.
func reclaimOverBudget(survivors []TsgoProcess, budget int64) []TsgoKill {
	var total int64
	for _, p := range survivors {
		total += p.RSS
	}
	sort.Slice(survivors, func(i, j int) bool { return survivors[i].Started.After(survivors[j].Started) })
	var kills []TsgoKill
	for _, p := range survivors {
		if total <= budget {
			break
		}
		if p.Class != TsgoRun {
			continue
		}
		kills = append(kills, TsgoKill{PID: p.PID, Class: p.Class, RSS: p.RSS, Started: p.Started, Reason: "combined tsgo footprint exceeds the machine budget"})
		total -= p.RSS
	}
	return kills
}
