package domain

import (
	"fmt"
	"strings"
)

// The gate's pure half: deciding what a command is, and what to say about it.
// Reading the hook payload and writing the reply live in app; everything that
// can be got wrong lives here, where a test can reach it. See ADR-088.

// heavyCommands are the only commands worth gating. Everything else defers in
// a few milliseconds, because a gate that thinks about `ls` is its own outage.
//
// Kept as a list of substrings rather than a clever matcher on purpose: a
// classifier that is hard to predict is worse than one that occasionally lets
// something through, since the failure mode of over-matching is a developer
// wondering why a trivial command was queued.
var heavyCommands = []string{
	"vitest",
	"test:unit",
	"test:integration",
	"typecheck",
	"tsgo",
	"biome",
	"lint",
	"next build",
	"go build",
	"docker build",
}

// integrationMarkers say a command drives the integration suite, which is never
// narrowed: specs/setup/integration-file-serialism.feature owns its concurrency
// and treats a worker count arriving from the environment as something to
// withdraw — or, if a second worker appears anyway, as a reason to fail the run.
var integrationMarkers = []string{"test:integration", "vitest.integration"}

// unitMarkers say a command drives the unit suite, which is the only kind with
// workers to divide.
var unitMarkers = []string{"test:unit", "vitest"}

// workerFlags are how a caller says it has already chosen a width. Respected
// rather than overridden.
var workerFlags = []string{"--maxWorkers", "--max-workers", "VITEST_MAX_WORKERS"}

// ClassifyCommand reports whether a command is heavy and, if so, what kind.
func ClassifyCommand(command string) (RunKind, bool) {
	if !containsAny(command, heavyCommands) {
		return SingleProcessRun, false
	}
	switch {
	case containsAny(command, integrationMarkers):
		return IntegrationRun, true
	case containsAny(command, unitMarkers):
		return UnitRun, true
	default:
		return SingleProcessRun, true
	}
}

// CallerSetWorkers reports whether the command already carries a worker count.
func CallerSetWorkers(command string) bool { return containsAny(command, workerFlags) }

// AlreadyWrapped reports whether a command is already running under haven's
// heavy class. Wrapping a second time would make the outer hold the slot the
// inner is waiting for.
func AlreadyWrapped(command string) bool {
	return strings.Contains(command, havenRunMarker)
}

// havenRunMarker is the subcommand and flag a wrapped command carries. Written
// once and used by both the wrapper and the idempotence check, so the two can
// never drift apart — the first draft had them written separately, the wrapper
// omitted the subcommand entirely, and only the round-trip test caught it.
//
// Deliberately excludes haven's path, since the wrapper writes an absolute one
// and a nested wrap could arrive by any spelling.
const havenRunMarker = "run --class heavy"

// WrapCommand rewrites a heavy command to run under haven's slot.
//
// The original is passed as a single argument for a shell to run, NOT spliced
// after a separator: tool_input.command is a shell string, so `pnpm test && echo
// done` spliced bare would gate only the first segment and let the rest run
// outside the slot.
//
// havenPath is haven's own absolute path, because installing it onto PATH is
// optional and a rewrite that yields "command not found" has broken a working
// command in the name of failing open.
func WrapCommand(havenPath, command string) string {
	return fmt.Sprintf("%s %s --sh %s", havenPath, havenRunMarker, shellQuote(command))
}

// shellQuote single-quotes s for safe interpolation, escaping embedded quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

// RefusalReason is what the model reads when the gate says no. It is the only
// channel to the model, so it carries the state, what to do instead, and — the
// part that is easy to omit and expensive to omit — an explicit instruction not
// to sleep on it.
//
// Sleeping is the failure mode this copy exists to prevent: an agent told to
// "try again shortly" can satisfy that with a sleep, which idles the session
// and re-creates the park the refusal was avoiding.
// A nil hint means the queue could not be quoted honestly — either nothing has
// been observed to estimate from, or the wait would fall outside the caller's
// cache window, in which case saying nothing beats a comfortable lie.
func RefusalReason(level Pressure, queueDepth int, hint *RetryHint) string {
	var b strings.Builder
	fmt.Fprintf(&b, "haven refused this run: the machine is at %s pressure", level)
	if queueDepth > 0 {
		fmt.Fprintf(&b, " with %d heavy runs queued", queueDepth)
	}
	b.WriteString(". ")
	if hint != nil {
		b.WriteString(hint.Describe())
		b.WriteString(". ")
	}
	b.WriteString("Do NOT sleep, poll or wait for this — an idle session loses its prompt cache. ")
	b.WriteString("Continue with work that does not spawn processes (reading, editing, writing, planning) ")
	b.WriteString("and come back to this at a natural stopping point.")
	return b.String()
}

// BackgroundDescription is what replaces a backgrounded command's description.
//
// It has to say the run was queued AND that it is running in the background,
// because a measured probe showed a model whose command was silently
// substituted ran it, noticed the output did not match what it asked for, and
// reported its environment as untrustworthy. An unexplained rewrite makes an
// agent doubt its own tools.
func BackgroundDescription(queueDepth int) string {
	if queueDepth > 0 {
		return fmt.Sprintf(
			"haven queued this behind %d other heavy runs and is running it in the background; "+
				"its result arrives when it finishes, not now", queueDepth)
	}
	return "haven is running this in the background; its result arrives when it finishes, not now"
}

// DurationKey reduces a command to the thing worth timing.
//
// Deliberately coarse: the useful question is "how long does test:unit take on
// this machine", not "how long does test:unit take for this exact file list".
// A per-invocation key would almost never have a prior observation, and an
// unobserved command is treated as long — so a too-specific key would quietly
// disable narrowing altogether.
func DurationKey(command string) string {
	for _, marker := range heavyCommands {
		if strings.Contains(command, marker) {
			return marker
		}
	}
	return ""
}

func containsAny(s string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}
