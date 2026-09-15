package app

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven gate` answers a Claude Code PreToolUse hook. The agent calls haven,
// haven answers; haven never invokes the agent. See ADR-091.
//
// EVERY path here defers rather than blocking. A hook that exits 2 BLOCKS the
// tool call, and an unrecovered Go panic exits with exactly 2 — so the
// language's crash default is a machine-wide tool-call blocker, and the
// discipline below (recover, never exit 2) is load-bearing rather than tidy.

// hookPayload is the subset of the PreToolUse payload the gate reads. Field
// names verified against a live session rather than docs.
type hookPayload struct {
	SessionID      string         `json:"session_id"`
	TranscriptPath string         `json:"transcript_path"`
	AgentID        string         `json:"agent_id"`
	PermissionMode string         `json:"permission_mode"`
	ToolName       string         `json:"tool_name"`
	ToolInput      map[string]any `json:"tool_input"`
}

// hookReply is what the gate writes to stdout on exit 0.
type hookReply struct {
	SystemMessage string             `json:"systemMessage,omitempty"`
	Specific      hookSpecificOutput `json:"hookSpecificOutput"`
}

type hookSpecificOutput struct {
	HookEventName            string         `json:"hookEventName"`
	PermissionDecision       string         `json:"permissionDecision,omitempty"`
	PermissionDecisionReason string         `json:"permissionDecisionReason,omitempty"`
	UpdatedInput             map[string]any `json:"updatedInput,omitempty"`
}

// deferReply is the neutral verdict: no opinion, so the tool call continues
// through the normal permission flow. It is what every failure path returns.
//
// PermissionDecision is left unset on purpose. "defer" reads like a decision
// but is not a value Claude Code's protocol recognizes - allow, deny and ask
// are the only ones documented, and omitting the field entirely is what "no
// decision to report" actually means. A background agent has nobody to ask,
// so an unrecognized string here has nowhere to resolve to and can stop its
// turn cold; an absent field cannot, because there is nothing to interpret.
func deferReply() hookReply {
	return hookReply{Specific: hookSpecificOutput{
		HookEventName: "PreToolUse",
	}}
}

// gateContext is what both wire formats need after decoding and classifying
// one hook payload. Ready is false - and Early carries the whole answer -
// whenever there is nothing left to decide: a decode failure, a cache-cost
// warning, a non-Bash tool, or a command that is not heavy or already wrapped.
type gateContext struct {
	payload hookPayload
	command string
	kind    domain.RunKind
	ready   bool
}

// decodeGateContext reads and classifies one hook payload - the prefix Claude's
// gate and Codex's gate both need before either decides anything, kept in one
// place so the two wire formats cannot drift on what counts as heavy.
func (o *Orchestrator) decodeGateContext(stdin io.Reader) (gateContext, hookReply) {
	var p hookPayload
	if json.NewDecoder(stdin).Decode(&p) != nil {
		return gateContext{}, deferReply()
	}
	if warning := o.cacheCostWarning(p); warning != "" {
		// The price is information, not a veto: this still carries no permission
		// decision, same as deferReply, because pricing an action must never need
		// an approval to ride on.
		return gateContext{}, hookReply{SystemMessage: warning, Specific: hookSpecificOutput{
			HookEventName: "PreToolUse",
		}}
	}
	if p.ToolName != "Bash" {
		return gateContext{}, deferReply()
	}
	command, _ := p.ToolInput["command"].(string)
	if command == "" || domain.AlreadyWrapped(command) {
		return gateContext{}, deferReply()
	}
	kind, heavy := domain.ClassifyCommand(command)
	if !heavy {
		return gateContext{}, deferReply()
	}
	return gateContext{payload: p, command: command, kind: kind, ready: true}, hookReply{}
}

// runGated answers one hook call under the same panic-recovery discipline
// every entry point needs: a panic must not reach the runtime, which would
// exit 2 and BLOCK the tool call. Recovering here converts any crash into
// whatever `decide` had already written to reply (its zero value is
// deferReply's own shape) - and logs what it caught, because a gate that
// panics on every call would otherwise degrade to "defer" forever and nobody
// would learn. The log goes nowhere near stdout, so saying so cannot affect
// the decision.
func (o *Orchestrator) runGated(stdout io.Writer, decide func() hookReply) {
	reply := deferReply()
	defer func() {
		if r := recover(); r != nil {
			o.log.Error("the gate panicked; deferring to the normal permission flow",
				zap.Any("panic", r), zap.ByteString("stack", debug.Stack()))
		}
		_ = json.NewEncoder(stdout).Encode(reply)
	}()
	reply = decide()
}

// Gate reads one hook payload and writes one reply for Claude Code. It never
// returns an error: there is no failure here worth blocking an agent for.
//
// It never rewrites the command it answers about. See decideHeavyMessage.
func (o *Orchestrator) Gate(stdin io.Reader, stdout io.Writer) {
	o.runGated(stdout, func() hookReply {
		ctx, early := o.decodeGateContext(stdin)
		if !ctx.ready {
			return early
		}
		return o.decideHeavyMessage(ctx.payload, ctx.command, ctx.kind)
	})
}

// decideHeavyMessage is the shared ladder for a command decided heavy - Gate
// and GateCodex both call it, and it NEVER rewrites tool_input.
//
// A rewrite used to mask the real command from three things at once: Claude
// Code's own permission rules (a prefix rule matching "haven run" over-admits
// an allow and a deny never gets to fire on the command it was written for),
// every log line, and every prompt the agent or a human reads back. Codex's
// gate used to keep rewriting anyway, on the theory that its own permission
// system does not share that prefix-matching hazard - but the rule is simpler
// than that exception: no hook rewrites the command it admits. Gating now
// lives in the heavy tools themselves - the compiler/lint/format/test/vitest
// bin shims and `make go-lint`, which already take a slot through
// `haven slot run` on their own - so the command either agent asked for is
// exactly the command that runs, and this only classifies and reports.
//
// The only permission decision left is a deny under red memory pressure with
// no slot free (domain.Refuse); everything else is a system message, silent
// for a plain Admit, describing what the run is expected to do - a prediction
// now, not an instruction, since nothing here enforces it any more.
func (o *Orchestrator) decideHeavyMessage(p hookPayload, command string, kind domain.RunKind) hookReply {
	caller := domain.CallerFromAgentID(p.AgentID, false)
	level := domain.ReadPressure(o.readPressureRecord())
	slots := o.slotState()
	queueDepth := 0
	if !slots.free() {
		queueDepth = slots.position()
	}

	decision := domain.DecideAdmission(domain.AdmissionRequest{
		Pressure:             level,
		IsSlotFree:           slots.free(),
		Caller:               caller,
		Kind:                 kind,
		ObservedDuration:     o.observedDuration(command),
		HasCallerWorkerCount: domain.CallerSetWorkers(command),
		EstimatedWait:        o.estimatedWait(queueDepth, command),
		// Nothing is rewritten any more, so there is no detached form left to
		// hand a wait too long to serve back to: that case is a Queue like any
		// other, blocking on the caller's own ceiling rather than the hook's.
		CanBackground: false,
	})

	if decision == domain.Refuse {
		var hint *domain.RetryHint
		if h, ok := domain.NewRetryHint(queueDepth, o.observedDuration(command), caller); ok {
			hint = &h
		}
		return refuse(level, queueDepth, hint)
	}

	prediction := predictionRequest{decision: decision, queueDepth: queueDepth, workers: o.narrowedWidth(slots)}
	if decision == domain.Queue {
		prediction.wait, prediction.hasWait = o.queueEstimate(queueDepth, command)
	}
	message := predictiveMessage(prediction)
	if message == "" {
		return deferReply()
	}
	return hookReply{SystemMessage: message, Specific: hookSpecificOutput{HookEventName: "PreToolUse"}}
}

// predictionRequest is what predictiveMessage needs to describe one decision.
type predictionRequest struct {
	decision   domain.Admission
	queueDepth int
	workers    int
	wait       time.Duration
	hasWait    bool
}

// predictiveMessage is what the gate says about a decision it is not
// enforcing itself - the classification and the queue estimate, silent for
// Admit: a line worth printing names something the caller did not already
// know and could act on.
//
// This is a PREDICTION, not an instruction, because nothing here rewrites the
// command any more. It agrees with the enforcement for every heavy command
// the gate classifies: the compiler, linter, formatter and vitest bin shims
// all take a slot through `haven slot run` on their own (dev/scripts/
// install-check-shims.mjs), and `make go-lint` does the same for
// golangci-lint - the gap this comment used to flag is closed.
func predictiveMessage(r predictionRequest) string {
	switch r.decision {
	case domain.Narrow:
		return fmt.Sprintf("haven: narrowed to %d test workers - the machine is busy, so this runs at a width that fits", r.workers)
	case domain.Queue:
		return "haven: " + queueNote(r.queueDepth, r.wait, r.hasWait)
	default:
		return ""
	}
}

// GateCodex answers Codex's own PreToolUse-shaped hook. It shares every
// admission decision with Gate and, like Gate, never rewrites tool_input: no
// hook rewrites the command it admits. See
// specs/setup/haven-agent-hooks.feature, "Codex heavy commands use the
// existing Haven gate" - enforcement lives in the heavy tools themselves
// (the compiler/lint/format/test/vitest bin shims and `make go-lint`, which
// already take a slot through `haven slot run` on their own), so the command
// Codex actually runs is exactly the command it asked to run.
func (o *Orchestrator) GateCodex(stdin io.Reader, stdout io.Writer) {
	o.runGated(stdout, func() hookReply {
		ctx, early := o.decodeGateContext(stdin)
		if !ctx.ready {
			return early
		}
		return o.decideHeavyMessage(ctx.payload, ctx.command, ctx.kind)
	})
}

// refuse denies with a reason the model can act on. The reason is the only
// channel to the model, so it carries the state, a retry hint when one can be
// quoted honestly, and an explicit instruction not to sleep on it.
func refuse(level domain.Pressure, queueDepth int, hint *domain.RetryHint) hookReply {
	return hookReply{Specific: hookSpecificOutput{
		HookEventName:            "PreToolUse",
		PermissionDecision:       "deny",
		PermissionDecisionReason: domain.RefusalReason(level, queueDepth, hint),
	}}
}

// queueNote spells the wait a caller is about to have, in runs ahead plus - when
// recent history says enough to guess - roughly how long that is. With no
// history at all it says only the count, exactly as it always has: a comfortable
// guess is worse than none.
func queueNote(depth int, wait time.Duration, hasWait bool) string {
	var base string
	switch {
	case depth <= 0:
		base = "queued for the machine-wide slot"
	case depth == 1:
		base = "queued behind 1 run"
	default:
		base = fmt.Sprintf("queued behind %d runs", depth)
	}
	if hasWait {
		base += ", " + domain.FormatWait(wait)
	}
	return base
}

func (o *Orchestrator) readPressureRecord() (domain.PressureRecord, bool, time.Time) {
	rec, ok := o.store.ReadPressure()
	return rec, ok, o.sys.Now()
}

// instructionFiles are the paths whose edit MAY invalidate the cached prefix.
//
// May, not does: where the harness places instructions in the prefix is not
// verified, which is why the warning hedges and why this only notifies.
var instructionFiles = []string{"CLAUDE.md", ".claude/rules/", ".claude/settings"}

// cacheCostWarning prices an edit that could bust a large cached prefix, and
// returns "" when there is nothing worth saying.
//
// It is a warning and never a block: a cache-busting edit is almost always
// deliberate, and the job is to make the price visible at the moment of the
// action rather than to prevent it. The channel is a system message, which the
// developer sees and the model does not — there is no primitive that shows the
// model a price and still lets the action through.
func (o *Orchestrator) cacheCostWarning(p hookPayload) string {
	if p.ToolName != "Edit" && p.ToolName != "Write" {
		return ""
	}
	path, _ := p.ToolInput["file_path"].(string)
	if path == "" || !containsAnyPath(path) {
		return ""
	}
	prefixTokens := domain.EstimateTokensFromBytes(transcriptSize(p.TranscriptPath))
	if domain.ChannelFor(domain.InstructionsEdit, prefixTokens) == domain.Silent {
		return ""
	}
	caller := domain.CallerFromAgentID(p.AgentID, false)
	return "haven: " + domain.InvalidationWarning(domain.InstructionsEdit, prefixTokens, caller)
}

func containsAnyPath(path string) bool {
	for _, marker := range instructionFiles {
		if strings.Contains(path, marker) {
			return true
		}
	}
	return false
}

// transcriptSize stats the session's transcript. Stat, not parse: the fast path
// budget forbids reading a file that reaches hundreds of MB, and the figure is
// an order-of-magnitude aid rather than an invoice.
func transcriptSize(path string) int64 {
	if path == "" {
		return 0
	}
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}

// slotState uses the shared capacity policy; the claim ledger supplies a
// best-effort estimate, while the flock at execution time enforces admission.
func (o *Orchestrator) slotState() slotState {
	return slotState{live: o.store.HeavyRuns(), limit: max(1, o.checkSlots())}
}

// fullWidth is the width a unit run takes when nobody narrows it further, and
// where that number came from - one machine-wide setting (HAVEN_TEST_WORKERS,
// read the way HAVEN_TYPECHECK_SLOTS is) rather than a per-worktree one, since
// the runs it divides among (narrowedWidth) are themselves counted
// machine-wide. Unset, it is derived from the machine's memory and cores, half
// the cores being what the repository's vitest configs already ask for with
// `maxWorkers: "50%"`.
func (o *Orchestrator) fullWidth() (int, string) {
	return domain.UnitTestFullWidth(o.sys.TotalMemory(), runtime.NumCPU(), os.Getenv("HAVEN_TEST_WORKERS"))
}

// narrowedWidth is how many workers a narrowed run actually gets, and the two
// roads to Narrow want different arithmetic.
//
// With a slot free, the machine is loaded rather than full, and the reduction is
// a fixed fraction. With no slot free, the run is starting alongside everything
// already in flight, so it divides by them — sizing against the limit instead
// would let ten agents each start "narrowed" and rebuild the burst.
func (o *Orchestrator) narrowedWidth(s slotState) int {
	full, _ := o.fullWidth()
	if s.free() {
		return domain.PressureWidth(full)
	}
	return domain.NarrowedWorkers(full, s.live)
}

// observedDuration is how long this command has taken before. Zero means never
// timed, which every caller treats as "assume long".
func (o *Orchestrator) observedDuration(command string) time.Duration {
	return o.store.ObservedDuration(domain.DurationKey(command))
}

// estimatedWait is queue depth times what a run of this kind actually takes.
// With nothing observed there is no honest estimate and the answer is zero,
// which reads as "cannot quote" rather than "no wait".
func (o *Orchestrator) estimatedWait(queueDepth int, command string) time.Duration {
	wait, ok := domain.EstimateWait(queueDepth, o.observedDuration(command))
	if !ok {
		return 0
	}
	return wait
}

// queueEstimate is the coarse figure queueNote adds to a Queue or Background
// message: each run currently visible as holding a slot contributes its own
// time left, and anything queued beyond what is visible falls back to the
// median for the command now asking. ok is false with no history at all,
// which is what keeps today's message unchanged when nothing has ever run.
func (o *Orchestrator) queueEstimate(queueDepth int, command string) (time.Duration, bool) {
	if queueDepth <= 0 {
		return 0, false
	}
	now := o.sys.Now()
	var held []domain.HeldRun
	for _, snap := range o.store.HeavyRunSnapshots() {
		held = append(held, domain.NewHeldRun(snap.Command, snap.StartedAt, now))
	}
	if len(held) > queueDepth {
		held = held[:queueDepth]
	}
	req := domain.QueuedWaitRequest{Held: held, AheadBeyond: queueDepth - len(held), OwnKind: domain.ClassifyHistoryKind(command)}
	return domain.EstimateQueuedWait(req, o.store.RunHistory())
}
