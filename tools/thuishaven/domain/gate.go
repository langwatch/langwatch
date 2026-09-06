package domain

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
)

// The gate's pure half: deciding what a command is, and what to say about it.
// Reading the hook payload and writing the reply live in app; everything that
// can be got wrong lives here, where a test can reach it. See ADR-091.

// GatedTools are the tool names the gate has a live branch for, and so the only
// ones worth waking it for.
//
// This list and the branches in app.Gate are one thing said twice, and they
// drifted: the installed matcher named Bash and Agent while the cache-cost
// warning it was meant to feed only ran for Edit and Write, so that half of the
// gate could not fire at all. Two rules keep them together. The matcher haven
// installs is DERIVED from this list rather than written out beside it, and a
// test drives every tool named here through the gate and fails if one of them
// produces no answer.
//
// Agent is absent deliberately. The spawn cap that would read it is complete in
// this package but not yet wired into the gate, and naming a tool nothing
// handles spends a process launch per sub-agent to reach an unconditional
// defer — the same defect as the one above, pointing the other way. Whoever
// wires it adds Agent back, and the test makes that mandatory rather than
// something to remember.
var GatedTools = []string{"Bash", "Edit", "Write"}

// HookMatcher is the PreToolUse matcher routing exactly GatedTools to the gate.
// Claude Code matches a tool name against it as an alternation.
func HookMatcher() string { return strings.Join(GatedTools, "|") }

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

// heavyBinaries are heavy runs matched on the BINARY INVOKED rather than by
// substring, and they are the TypeScript compiler's two names because "tsc"
// cannot go in the list above: it is a substring of "tsconfig.json", so `cat
// tsconfig.json` and every `-p tsconfig.tsgo.json` argument would class heavy.
// That is precisely the over-match heavyCommands' comment warns about, and the
// developer wondering why `cat` was queued would be right.
//
// Matching the last path segment of a word keeps the rule as predictable as a
// substring while staying honest about a three-letter name:
// `./node_modules/.bin/tsc`, `pnpm exec tsc` and `/x/lib/tsc --noEmit` all
// count, `tsconfig.json`, `mytsc`, `tsclint` and the shim's own `tsc.real`
// (already inside the queue) do not. `tsgo` is here too rather than only in
// heavyCommands: one compiler, one rule. It stays in heavyCommands as well, so
// nothing that classes heavy today stops doing so.
var heavyBinaries = typeScriptCompilerBinaries

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
	if !containsAny(command, heavyCommands) && !invokesAny(command, heavyBinaries) {
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
const havenRunMarker = "run --class " + HeavySlotClass

// HeavySlotClass is the only slot pool there is. Named here, where the wrapper
// writes it, so the command that validates the flag and the command that emits
// it cannot come to disagree about its spelling.
const HeavySlotClass = "heavy"

// WrapOptions carries what the gate already decided into the wrapped command.
//
// Without it `haven run` re-derives its behaviour from nothing and the decision
// is silently discarded: an unnamed caller resolves to a main session and waits
// on the thirty-minute failsafe rather than the four-minute ceiling its
// five-minute cache needs, and a narrowed run is indistinguishable from a
// queued one.
type WrapOptions struct {
	// AgentID is the caller's agent id, which picks the wait ceiling because it
	// picks the prompt-cache floor.
	AgentID string
	// Workers is the narrowed width. Zero means "not narrowed", and the run keeps
	// whatever width its own config chooses.
	Workers int
}

// WrapCommand rewrites a heavy command to run under haven's slot.
//
// The original is passed as a single argument for a shell to run, NOT spliced
// after a separator: tool_input.command is a shell string, so `pnpm test && echo
// done` spliced bare would gate only the first segment and let the rest run
// outside the slot.
//
// havenPath is haven's own absolute path, because installing it onto PATH is
// optional and a rewrite that yields "command not found" has broken a working
// command in the name of failing open. It is quoted for the same reason it is
// absolute: a checkout under a directory with a space would otherwise split
// into two words and fail exactly the way the absolute path exists to prevent.
func WrapCommand(havenPath, command string, opts WrapOptions) string {
	var b strings.Builder
	b.WriteString(ShellQuote(havenPath))
	b.WriteString(" ")
	b.WriteString(havenRunMarker)
	if opts.AgentID != "" {
		b.WriteString(" --agent-id ")
		b.WriteString(ShellQuote(opts.AgentID))
	}
	if opts.Workers > 0 {
		fmt.Fprintf(&b, " --workers %d", opts.Workers)
	}
	b.WriteString(" --sh ")
	b.WriteString(ShellQuote(command))
	return b.String()
}

// ShellQuote single-quotes s for safe interpolation, escaping embedded quotes.
func ShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

// ShellWords splits a command the way a shell would, undoing the quoting
// ShellQuote applies. It exists because a command we WROTE has to be read back:
// the gate hook records haven's own absolute path, quoted, and recognising it
// later by splitting on whitespace would tear a path with a space in it into
// several words and fail to recognise haven's own handiwork.
//
// It is a reader for our own output, not a shell: expansion, substitution and
// operators are all deliberately absent, since nothing here needs to know what
// `$HOME` or `&&` mean — only where one word ends and the next begins.
func ShellWords(command string) []string {
	s := &shellScanner{}
	for _, r := range command {
		s.next(r)
	}
	s.flush()
	return s.words
}

// shellScanner is ShellWords' state. A type rather than locals in a loop so each
// state gets its own named method instead of one switch nested inside another.
type shellScanner struct {
	words   []string
	word    strings.Builder
	inWord  bool
	quote   rune
	escaped bool
}

func (s *shellScanner) next(r rune) {
	switch {
	case s.escaped:
		s.word.WriteRune(r)
		s.escaped = false
	case s.quote != 0:
		s.quoted(r)
	default:
		s.bare(r)
	}
}

// quoted consumes a rune inside quotes. Single quotes take everything
// literally; double quotes honour a backslash, which is what makes ShellQuote's
// own '"'"' escape read back as one apostrophe.
func (s *shellScanner) quoted(r rune) {
	if s.quote == '\'' {
		if r == '\'' {
			s.quote = 0
			return
		}
		s.word.WriteRune(r)
		return
	}
	switch r {
	case '"':
		s.quote = 0
	case '\\':
		s.escaped = true
	default:
		s.word.WriteRune(r)
	}
}

func (s *shellScanner) bare(r rune) {
	switch {
	case r == '\'' || r == '"':
		s.quote = r
		s.inWord = true
	case r == '\\':
		s.escaped = true
		s.inWord = true
	case unicode.IsSpace(r):
		s.flush()
	default:
		s.word.WriteRune(r)
		s.inWord = true
	}
}

// flush ends the current word. An opened quote counts as a word even before any
// character lands in it, so a pair of quotes with nothing between them is an
// empty argument rather than nothing at all.
func (s *shellScanner) flush() {
	if !s.inWord {
		return
	}
	s.words = append(s.words, s.word.String())
	s.word.Reset()
	s.inWord = false
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
//
// Keyed on the CLASSIFIED KIND rather than on which substring matched first.
// `npx vitest run --config vitest.integration.config.ts` classifies as an
// integration run but matches "vitest" before "test:integration", so a list
// order key filed a ten-minute integration run under the unit bucket — and a
// polluted estimate narrows a run that should have queued.
func DurationKey(command string) string {
	kind, heavy := ClassifyCommand(command)
	if !heavy {
		return ""
	}
	switch kind {
	case IntegrationRun:
		return "integration"
	case UnitRun:
		return "unit"
	default:
		// Single-process runs are not one population: a typecheck and a docker
		// build differ by an order of magnitude, so each keeps its own bucket.
		for _, marker := range heavyCommands {
			if strings.Contains(command, marker) {
				return marker
			}
		}
		// A run reached only by binary name is the compiler, and the compiler
		// is one population under both its names — a `tsc` run belongs in the
		// same bucket its `tsgo` predecessor filled, not in no bucket at all
		// (an unobserved command is treated as long, which disables narrowing).
		if invokesAny(command, heavyBinaries) {
			return TypeScriptCompilerClass
		}
		return ""
	}
}

// invokesAny reports whether any word of the command invokes one of the named
// binaries, comparing the word's last path segment so a binary is matched
// however it was reached. A word is not a substring: `tsconfig.json` and
// `tsc.real` are not `tsc`.
func invokesAny(command string, binaries []string) bool {
	for _, word := range strings.Fields(command) {
		if slices.Contains(binaries, binaryBase(word)) {
			return true
		}
	}
	return false
}

func containsAny(s string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}
