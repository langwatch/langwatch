package domain

import (
	"fmt"
	"path/filepath"
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

// heavyScripts are the pnpm script names and make targets that cost real
// time, matched as a WHOLE WORD at the invocation's script/target position -
// `pnpm [--filter X] [run] SCRIPT` or `make TARGET` - never as a substring of
// a longer name or an unrelated path.
var heavyScripts = []string{
	"typecheck", "typecheck:one", "typecheck:all",
	"lint", "lint:fix", "format",
	"test", "test:unit", "test:integration",
}

// heavySubcommands are BINARY SUBCOMMAND pairs where the binary alone is used
// for all kinds of cheap things (`go vet`, `docker ps`, `next dev`) and only
// this exact next word costs real time.
var heavySubcommands = map[string]string{
	"go":     "build",
	"docker": "build",
	"next":   "build",
}

// heavyBinaries are heavy runs matched on the BINARY INVOKED rather than by
// substring: the TypeScript compiler's two names, because "tsc" cannot be
// matched as a substring of the whole command line (it is a substring of
// "tsconfig.json", so `cat tsconfig.json` would class heavy), plus the other
// tools that are reached directly as often as through a package script.
//
// Matching the last path segment of a word keeps the rule as predictable as a
// substring while staying honest about a three-letter name:
// `./node_modules/.bin/tsc`, `pnpm exec tsc` and `/x/lib/tsc --noEmit` all
// count, `tsconfig.json`, `mytsc`, `tsclint` and the shim's own `tsc.real`
// (already inside the queue) do not.
var heavyBinaries = append(append([]string{}, typeScriptCompilerBinaries...),
	"vitest", "golangci-lint", "oxlint", "oxfmt", "eslint")

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
//
// Classification is by INVOCATION, not by substring: a command is heavy only
// when one of its shell segments actually runs a heavy tool at the program
// position, so `grep -rn vitest .` and `cat tsconfig.json` are never gated
// merely for mentioning one. See DEFECT-2026-09-10 in the gate test for the
// incident this replaced (two routine commands queued behind the machine-wide
// slot for mentioning "vitest" and "golangci" in a grep pattern).
func ClassifyCommand(command string) (RunKind, bool) {
	kind, heavy, _ := classifyDetail(command)
	return kind, heavy
}

// classifyDetail is ClassifyCommand plus the DurationKey bucket for a
// single-process run, so the two never classify the same command two
// different ways by drifting apart.
func classifyDetail(command string) (kind RunKind, heavy bool, bucket string) {
	if ungatedCommandMode(command) {
		return SingleProcessRun, false, ""
	}
	for _, segment := range commandSegments(command) {
		segmentBucket, ok := heavyInvocationBucket(segment)
		if !ok {
			continue
		}
		switch {
		case containsAny(segment, integrationMarkers):
			return IntegrationRun, true, segmentBucket
		case containsAny(segment, unitMarkers):
			return UnitRun, true, segmentBucket
		default:
			return SingleProcessRun, true, segmentBucket
		}
	}
	return SingleProcessRun, false, ""
}

// Watches cannot hold a finite check slot for the lifetime of a dev session.
// Informational flags bypass admission only for a single shell command, so
// `tsc --version && pnpm typecheck` still counts the check that follows.
func ungatedCommandMode(command string) bool {
	words := ShellWords(command)
	for i, word := range words {
		switch word {
		case "--watch", "--watch=true", "--lsp":
			return true
		case "-w":
			if invokesAny(strings.Join(words[:i], " "), []string{"tsc", "tsgo", "vitest"}) {
				return true
			}
		}
	}
	if strings.ContainsAny(command, ";&|\n`$") {
		return false
	}
	for _, word := range words {
		switch word {
		case "--help", "--version", "--init":
			return true
		}
	}
	return false
}

// CallerSetWorkers reports whether the command already carries a worker count.
func CallerSetWorkers(command string) bool { return containsAny(command, workerFlags) }

// AlreadyWrapped reports whether a command is already running under haven's
// heavy class. Wrapping a second time would make the outer hold the slot the
// inner is waiting for.
func AlreadyWrapped(command string) bool {
	words := ShellWords(command)
	for i, word := range words {
		binary := filepath.Base(word)
		if (binary != "haven" && !strings.HasPrefix(binary, "haven.")) || i+1 >= len(words) {
			continue
		}
		if i > 0 && words[i-1] != "&&" && words[i-1] != ";" && words[i-1] != "||" {
			continue
		}
		switch words[i+1] {
		case "run", "typecheck":
			return true
		case "slot":
			if i+2 < len(words) && words[i+2] == "run" {
				return true
			}
		}
	}
	return false
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
	kind, heavy, bucket := classifyDetail(command)
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
		// build differ by an order of magnitude, so each keeps its own bucket,
		// named after the invocation that made it heavy.
		return bucket
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

// commandSegments splits a command into the pieces a shell would run one
// after another: at unquoted ;, &&, || and | (also plain |, the same
// boundary) and at newlines. Quotes and escapes are honored the way
// ShellWords honors them, so an operator inside a quoted string, an awk
// program, a grep pattern or a heredoc body never ends a segment.
func commandSegments(command string) []string {
	s := &segmentScanner{}
	runes := []rune(command)
	for i := 0; i < len(runes); i++ {
		i += s.consume(runes, i)
	}
	s.flush()
	return s.segments
}

// segmentScanner is commandSegments' state. A type rather than locals in a
// loop, the same shape as shellScanner above, so each state gets its own
// named method instead of one switch nested inside another.
type segmentScanner struct {
	segments []string
	cur      strings.Builder
	quote    rune
	escaped  bool
}

// consume handles the rune at runes[i] and reports how many further runes,
// beyond that one, it also consumed (a two-rune operator such as && or ||).
func (s *segmentScanner) consume(runes []rune, i int) int {
	r := runes[i]
	switch {
	case s.escaped:
		s.cur.WriteRune(r)
		s.escaped = false
		return 0
	case s.quote != 0:
		s.quoted(r)
		return 0
	}
	if extra, isBoundary := segmentBoundaryWidth(runes, i); isBoundary {
		s.flush()
		return extra
	}
	s.bare(r)
	return 0
}

// quoted consumes a rune under an open quote. Only a double quote honors a
// backslash escape - inside single quotes, everything up to the closing
// quote is literal, matching shellScanner.quoted's own rule.
func (s *segmentScanner) quoted(r rune) {
	s.cur.WriteRune(r)
	if r == s.quote {
		s.quote = 0
		return
	}
	s.escaped = s.quote == '"' && r == '\\'
}

// bare consumes a rune outside any quote or operator: it opens a quote,
// marks an escape, or is written through as ordinary text.
func (s *segmentScanner) bare(r rune) {
	switch r {
	case '\'', '"':
		s.quote = r
	case '\\':
		s.escaped = true
	}
	s.cur.WriteRune(r)
}

// flush ends the current segment, even an empty one - two operators in a row
// (";;", "&&  &&") name an empty command, which is what a shell would say too.
func (s *segmentScanner) flush() {
	s.segments = append(s.segments, s.cur.String())
	s.cur.Reset()
}

// segmentBoundaryWidth reports whether the rune at runes[i] starts an
// unquoted segment operator (;, &&, ||, | or a newline), and how many
// further runes beyond it the operator also consumes.
func segmentBoundaryWidth(runes []rune, i int) (extra int, isBoundary bool) {
	switch runes[i] {
	case '\n', ';':
		return 0, true
	case '|':
		if i+1 < len(runes) && runes[i+1] == '|' {
			return 1, true
		}
		return 0, true
	case '&':
		if i+1 < len(runes) && runes[i+1] == '&' {
			return 1, true
		}
	}
	return 0, false
}

// heavyInvocationBucket reports whether a shell segment actually invokes a
// heavy tool at its program position, and if so, the DurationKey bucket it
// belongs under. Only the program position counts, after stripping the shell
// prefixes that shift where it sits (a leading cd is its own segment already,
// split off by commandSegments) - a word inside quotes, an awk program, a
// grep pattern or a heredoc body is never examined.
func heavyInvocationBucket(segment string) (string, bool) {
	words := programWords(ShellWords(segment))
	if len(words) == 0 {
		return "", false
	}
	switch words[0] {
	case "npx":
		return heavyBinaryBucket(words[1:])
	case "pnpm":
		return heavyPnpmBucket(words[1:])
	case "make":
		return heavyMakeBucket(words[1:])
	}
	if bucket, ok := heavyBinaryBucket(words); ok {
		return bucket, true
	}
	return heavySubcommandBucket(words)
}

// programWords returns a segment's words starting at the position that
// actually names what runs, skipping the shell prefixes that shift it: a
// leading run of VAR=value assignments (HAVEN_AGENT=1 among them), and the
// env / time / nice wrappers together with their own flags.
func programWords(words []string) []string {
	for len(words) > 0 {
		rest, stripped := stripOneShellPrefix(words)
		if !stripped {
			return words
		}
		words = rest
	}
	return words
}

// stripOneShellPrefix removes one shell prefix from the front of words, if
// present: a VAR=value assignment, or the env / time / nice wrapper together
// with its own flags (and, for env, any assignments it carries too).
func stripOneShellPrefix(words []string) (rest []string, stripped bool) {
	switch {
	case isAssignment(words[0]):
		return words[1:], true
	case words[0] == "env":
		return stripLeadingFlags(words[1:], true), true
	case words[0] == "time" || words[0] == "nice":
		return stripLeadingFlags(words[1:], false), true
	default:
		return words, false
	}
}

// stripLeadingFlags drops leading "-"-prefixed words, and, when
// allowAssignments is set, leading VAR=value words too, stopping at the
// first word that is neither.
func stripLeadingFlags(words []string, allowAssignments bool) []string {
	for len(words) > 0 && (strings.HasPrefix(words[0], "-") || (allowAssignments && isAssignment(words[0]))) {
		words = words[1:]
	}
	return words
}

// isAssignment reports whether word is a shell VAR=value prefix - the form
// both the hook's own env and the incident's own commands use
// (HAVEN_AGENT=1 haven slot explain).
func isAssignment(word string) bool {
	name, _, found := strings.Cut(word, "=")
	if !found || name == "" {
		return false
	}
	for i, r := range name {
		switch {
		case r == '_' || unicode.IsUpper(r) || unicode.IsLower(r):
			continue
		case i > 0 && unicode.IsDigit(r):
			continue
		default:
			return false
		}
	}
	return true
}

// heavyBinaryBucket matches the first word's binary directly: the compiler
// under either name, or one of the other tools invoked straight rather than
// through a package script.
func heavyBinaryBucket(words []string) (string, bool) {
	if len(words) == 0 {
		return "", false
	}
	base := binaryBase(words[0])
	if isTypeScriptCompilerBinary(base) {
		return TypeScriptCompilerClass, true
	}
	if slices.Contains(heavyBinaries, base) {
		return base, true
	}
	return "", false
}

// heavyPnpmBucket handles `pnpm exec|dlx BINARY` (a binary invoked directly)
// and `pnpm [--filter X] [run] SCRIPT` (a package script). The script name
// has to match heavyScripts exactly - a script that merely contains "lint"
// in a longer name is not this.
func heavyPnpmBucket(words []string) (string, bool) {
	if len(words) == 0 {
		return "", false
	}
	if words[0] == "exec" || words[0] == "dlx" {
		return heavyBinaryBucket(words[1:])
	}
	for len(words) > 0 {
		rest, stripped := stripOnePnpmPrefixToken(words)
		if !stripped {
			break
		}
		words = rest
	}
	if len(words) > 0 && slices.Contains(heavyScripts, words[0]) {
		return words[0], true
	}
	return "", false
}

// stripOnePnpmPrefixToken removes one token from before a pnpm script name:
// --filter (with its value, whether attached or given as the next word),
// "run", or any other flag.
func stripOnePnpmPrefixToken(words []string) (rest []string, stripped bool) {
	switch {
	case words[0] == "--filter":
		if len(words) > 1 {
			return words[2:], true
		}
		return words[1:], true
	case strings.HasPrefix(words[0], "--filter="):
		return words[1:], true
	case words[0] == "run":
		return words[1:], true
	case strings.HasPrefix(words[0], "-"):
		return words[1:], true
	default:
		return words, false
	}
}

// heavyMakeBucket matches `make TARGET`: the target is heavy only when it is
// one of the same names a pnpm script is heavy under.
func heavyMakeBucket(words []string) (string, bool) {
	if len(words) == 0 {
		return "", false
	}
	if slices.Contains(heavyScripts, words[0]) {
		return words[0], true
	}
	return "", false
}

// heavySubcommandBucket matches BINARY SUBCOMMAND pairs: the binary alone is
// used for all kinds of cheap things, so only this exact next word counts.
func heavySubcommandBucket(words []string) (string, bool) {
	if len(words) < 2 {
		return "", false
	}
	base := binaryBase(words[0])
	if sub, ok := heavySubcommands[base]; ok && words[1] == sub {
		return base + " " + sub, true
	}
	return "", false
}
