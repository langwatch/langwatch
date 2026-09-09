package domain

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
)

// How long a queued run should expect to wait, and how much longer an active
// one has left. Both read the same short history of completed heavy runs
// (RunRecord) and both degrade to silence rather than a guess: with nothing
// recorded, neither the gate's queue message nor `haven slot explain` says
// anything about time at all.

// HistoryKind is the coarse bucket a completed run is filed under - coarser
// than DurationKey, so each bucket stays populated enough for a real median.
type HistoryKind string

// The five buckets a run's history is filed under.
const (
	KindTypecheck HistoryKind = "typecheck"
	KindLint      HistoryKind = "lint"
	KindFormat    HistoryKind = "format"
	KindTest      HistoryKind = "test"
	KindOther     HistoryKind = "other"
)

// RunRecord is one completed heavy run - the unit the wait estimate and the
// per-holder "how long left" figure are both built from.
type RunRecord struct {
	Kind      HistoryKind   `json:"kind"`
	StartedAt time.Time     `json:"startedAt"`
	Duration  time.Duration `json:"duration"`
	ExitCode  int           `json:"exitCode"`
}

// Succeeded reports whether this run exited cleanly. Only a completed run
// that succeeded is evidence of how long its kind usually takes - the same
// principle ObserveDuration already applies to the narrowing estimate.
func (r RunRecord) Succeeded() bool { return r.ExitCode == 0 }

// RunHistoryCap is how many recent runs the history keeps. Old enough entries
// are dropped rather than kept forever: the useful question is how long a
// kind takes lately, not across the file's whole lifetime.
const RunHistoryCap = 200

// HeldRun is one run currently holding a slot, in the terms the estimate
// needs: what kind it is and how long it has already run.
type HeldRun struct {
	Kind    HistoryKind
	Elapsed time.Duration
}

// NewHeldRun turns a raw snapshot (its command, when it started) into what
// the estimate needs, against now.
func NewHeldRun(command string, startedAt, now time.Time) HeldRun {
	return HeldRun{Kind: ClassifyHistoryKind(command), Elapsed: now.Sub(startedAt)}
}

// formatWords are how a format run names itself. oxfmt is not in
// heavyCommands - it is reached through its own bin shim rather than a
// substring match - so it needs its own check here.
var formatWords = []string{"format", "format:check", "format:write"}

// ClassifyHistoryKind buckets a command into the five kinds a run's history
// is filed under, the same way the gate already classifies commands
// (ClassifyCommand, DurationKey) but coarsened.
func ClassifyHistoryKind(command string) HistoryKind {
	if isFormatCommand(command) {
		return KindFormat
	}
	kind, heavy := ClassifyCommand(command)
	switch {
	case !heavy:
		return KindOther
	case kind == UnitRun || kind == IntegrationRun:
		return KindTest
	case containsAny(command, []string{"typecheck", "tsgo"}) || invokesAny(command, heavyBinaries):
		return KindTypecheck
	case containsAny(command, []string{"lint"}):
		return KindLint
	default:
		return KindOther
	}
}

// isFormatCommand matches the formatter by word, not substring - "format" as
// a whole pnpm script name, or oxfmt as the binary invoked, however it was
// reached (mirrors invokesAny's own path handling).
func isFormatCommand(command string) bool {
	for _, word := range strings.Fields(command) {
		if slices.Contains(formatWords, word) || binaryBase(word) == "oxfmt" {
			return true
		}
	}
	return false
}

// waitFloor is the least a run ahead in the queue is ever assumed to still
// take - a run that looks done from its median is still exiting, cleaning up,
// or about to be. Also the boundary FormatWait calls "a few seconds".
const waitFloor = 5 * time.Second

// durationsFor is the recent successful durations for kind, or - kind "" -
// every recent successful duration regardless of kind.
func durationsFor(history []RunRecord, kind HistoryKind) []time.Duration {
	var out []time.Duration
	for _, rec := range history {
		if !rec.Succeeded() {
			continue
		}
		if kind != "" && rec.Kind != kind {
			continue
		}
		out = append(out, rec.Duration)
	}
	return out
}

func median(durations []time.Duration) time.Duration {
	sorted := append([]time.Duration(nil), durations...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	n := len(sorted)
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

// medianFor is the median recent duration for kind, or - when kind has no
// history of its own - the median across every kind. ok is false only when
// nothing at all has been recorded.
func medianFor(history []RunRecord, kind HistoryKind) (time.Duration, bool) {
	durations := durationsFor(history, kind)
	if len(durations) == 0 {
		durations = durationsFor(history, "")
	}
	if len(durations) == 0 {
		return 0, false
	}
	return median(durations), true
}

// timeLeft is how much longer a run of kind is expected to run, given it has
// already run for elapsed. ok is false only when there is no history to
// estimate from; past is true once elapsed has already reached the median -
// there is nothing left worth naming beyond "it is running long".
func timeLeft(kind HistoryKind, elapsed time.Duration, history []RunRecord) (remaining time.Duration, past bool, ok bool) {
	med, found := medianFor(history, kind)
	if !found {
		return 0, false, false
	}
	if elapsed >= med {
		return 0, true, true
	}
	return med - elapsed, false, true
}

// DescribeTimeLeft renders how much longer an active run is expected to
// take, or "" when there is no history to say anything from.
func DescribeTimeLeft(kind HistoryKind, elapsed time.Duration, history []RunRecord) string {
	remaining, past, ok := timeLeft(kind, elapsed, history)
	switch {
	case !ok:
		return ""
	case past:
		return "longer than usual"
	default:
		return FormatWait(remaining) + " left"
	}
}

// contributionToWait is what a held run adds to a queued caller's estimate:
// its own time left, floored so a run that is almost done - or already past
// its median - still counts for a moment of finishing up rather than nothing.
func contributionToWait(kind HistoryKind, elapsed time.Duration, history []RunRecord) (time.Duration, bool) {
	remaining, past, ok := timeLeft(kind, elapsed, history)
	if !ok {
		return 0, false
	}
	if past || remaining < waitFloor {
		return waitFloor, true
	}
	return remaining, true
}

// QueuedWaitRequest is everything EstimateQueuedWait needs: the runs already
// visible as holding a slot, how many more are queued behind them that
// cannot be seen yet, and the kind of the run now asking - the best guess
// available for a waiter whose own command is not yet known.
type QueuedWaitRequest struct {
	Held        []HeldRun
	AheadBeyond int
	OwnKind     HistoryKind
}

// EstimateQueuedWait is how long a caller should expect to wait: every held
// run contributes its own time left, and req.AheadBeyond further runs still
// ahead that cannot be seen yet are each estimated at req.OwnKind's median.
// ok is false only when there is nothing recorded to estimate from at all.
func EstimateQueuedWait(req QueuedWaitRequest, history []RunRecord) (time.Duration, bool) {
	if len(history) == 0 {
		return 0, false
	}
	var total time.Duration
	counted := false
	for _, h := range req.Held {
		contribution, ok := contributionToWait(h.Kind, h.Elapsed, history)
		if !ok {
			return 0, false
		}
		total += contribution
		counted = true
	}
	if req.AheadBeyond > 0 {
		med, ok := medianFor(history, req.OwnKind)
		if !ok {
			return 0, false
		}
		total += time.Duration(req.AheadBeyond) * med
		counted = true
	}
	if !counted {
		return 0, false
	}
	return total, true
}

// FormatWait renders an estimated duration coarsely, on purpose: the
// estimate is a median times a small count, not a promise, and a number to
// the second would claim a precision it does not have.
func FormatWait(d time.Duration) string {
	switch {
	case d < 15*time.Second:
		return "a few seconds"
	case d < 2*time.Minute:
		return fmt.Sprintf("about %ds", int(d.Round(10*time.Second).Seconds()))
	default:
		return fmt.Sprintf("about %d min", int(d.Round(time.Minute).Minutes()))
	}
}
