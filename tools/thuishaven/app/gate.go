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

// autoApprovingModes are the permission modes where a session already approves
// tool calls on its own. Only GateCodex still reads this: Codex's own
// permission system does not have the prefix-matching hazard that made Claude's
// gate stop rewriting (see decideHeavyMessage's doc comment), so Codex's
// command is still rewritten, and only in a mode that can already carry an
// "allow" it did not ask a human for.
var autoApprovingModes = map[string]bool{
	"bypassPermissions": true,
	"acceptEdits":       true,
	"auto":              true,
	"dontAsk":           true,
}

// gateContext is what both wire formats need after decoding and classifying
// one hook payload. Ready is false - and Early carries the whole answer  -
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

// decideHeavyMessage is Claude's ladder for a command decided heavy. It NEVER
// rewrites tool_input.
//
// A rewrite used to mask the real command from three things at once: Claude
// Code's own permission rules (a prefix rule matching "haven run" over-admits
// an allow and a deny never gets to fire on the command it was written for),
// every log line, and every prompt the agent or a human reads back. Gating now
// lives in the heavy tools themselves - the compiler/lint/format/test bin
// shims and package scripts, which already take a slot through
// `haven slot run` on their own - so the command the model asked for is
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

// predictiveMessage is what Claude's gate says about a decision it is not
// enforcing itself - the classification and the queue estimate, silent for
// Admit, the same rule admissionMessage already keeps: a line worth printing
// names something the caller did not already know and could act on.
//
// KNOWN GAP, not silently accepted: this is a PREDICTION now, not an
// instruction, because nothing here rewrites the command any more. For a
// command whose bin shim or package script already takes a slot on its own
// (tsc, tsgo, typecheck, lint, format), the prediction and the enforcement
// agree. For one that does not yet (a bare vitest invocation, golangci-lint),
// the message can currently describe a queue or a narrower width that nothing
// downstream applies - closing that gap means giving vitest and golangci-lint
// their own slot-taking shim, tracked as follow-up work, not built here.
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

// GateCodex shares admission decisions with Claude's gate and projects the
// Codex wire format. Unlike Gate, it still rewrites the command through
// `haven run`: Codex's own permission system does not match on a command
// prefix the way Claude's does, so the hazard that made Claude's gate stop
// rewriting does not apply here, and specs/setup/haven-agent-hooks.feature's
// "Codex heavy commands use the existing Haven gate" scenario is unchanged.
func (o *Orchestrator) GateCodex(stdin io.Reader, stdout io.Writer) {
	o.runGated(stdout, func() hookReply {
		ctx, early := o.decodeGateContext(stdin)
		if !ctx.ready {
			return early
		}
		reply := o.decideHeavy(ctx.payload, ctx.command, ctx.kind)
		// Gate itself already leaves PermissionDecision unset for a neutral call -
		// there is nothing left here to strip.
		//
		// Codex preserves execution options around the rewritten command. Claude's
		// background/timeout fields are not part of its documented Bash rewrite.
		if reply.Specific.UpdatedInput["run_in_background"] == true {
			reply.SystemMessage = "haven: queued"
		}
		for field := range reply.Specific.UpdatedInput {
			if field != "command" {
				delete(reply.Specific.UpdatedInput, field)
			}
		}
		return reply
	})
}

// decideHeavy is Codex's ladder for a command decided heavy: it still
// rewrites the command through `haven run`, carrying the decision with it.
func (o *Orchestrator) decideHeavy(p hookPayload, command string, kind domain.RunKind) hookReply {
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
		CanBackground:        autoApprovingModes[p.PermissionMode],
	})

	switch decision {
	case domain.Refuse:
		var hint *domain.RetryHint
		if h, ok := domain.NewRetryHint(queueDepth, o.observedDuration(command), caller); ok {
			hint = &h
		}
		return refuse(level, queueDepth, hint)
	case domain.Admit, domain.Background, domain.Narrow, domain.Queue:
		// All admitted runs hold a slot; decisions differ in how the wrapped run
		// behaves. Rewriting needs an approval, so a session that still prompts is
		// left alone entirely.
		if !autoApprovingModes[p.PermissionMode] {
			return deferReply()
		}
		req := rewrapRequest{
			command:    command,
			decision:   decision,
			queueDepth: queueDepth,
			agentID:    p.AgentID,
			slots:      slots,
		}
		if decision == domain.Queue || decision == domain.Background {
			req.estimatedWait, req.hasWaitEstimate = o.queueEstimate(queueDepth, command)
		}
		return o.rewrap(req)
	default:
		return deferReply()
	}
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

// rewrapRequest is everything the rewrite needs from the decision that was just
// taken. It travels as one value because dropping any part of it is exactly the
// failure this seam had: a rewrite that encodes none of what was decided leaves
// `haven run` to re-derive it from an empty command line, and every decision
// collapses back to the default.
type rewrapRequest struct {
	command    string
	decision   domain.Admission
	queueDepth int
	agentID    string
	slots      slotState
	// estimatedWait and hasWaitEstimate are queueNote's coarse figure for a
	// Queue or Background decision. hasWaitEstimate false means there is no
	// history to estimate from, and the message says nothing about time at
	// all - exactly what it said before this existed.
	estimatedWait   time.Duration
	hasWaitEstimate bool
}

// rewrap rewrites the command to run under haven's slot, carrying the decision
// with it.
func (o *Orchestrator) rewrap(r rewrapRequest) hookReply {
	opts := domain.WrapOptions{AgentID: r.agentID}
	if r.decision == domain.Narrow {
		opts.Workers = o.narrowedWidth(r.slots)
	}
	input := map[string]any{
		"command": domain.WrapCommand(o.havenPath(), r.command, opts),
	}
	systemMessage := admissionMessage(r, opts.Workers)

	if r.decision == domain.Background {
		input["run_in_background"] = true
		input["description"] = domain.BackgroundDescription(r.queueDepth)
	} else {
		// The tool's own timeout has to cover the admission wait as well as the
		// run. Only the WAIT is bounded by the cache window; capping total
		// runtime there would kill a long suite outright.
		//
		// A session configured with a lower BASH_MAX_TIMEOUT_MS clamps this back
		// down to its own maximum, which is the same ceiling the command would
		// have had unwrapped — the rewrite cannot raise a limit the harness sets,
		// and asking for more than it allows costs nothing.
		input["timeout"] = int(domain.LongFailsafe / time.Millisecond)
	}

	return hookReply{
		SystemMessage: systemMessage,
		Specific: hookSpecificOutput{
			HookEventName:            "PreToolUse",
			PermissionDecision:       "allow",
			PermissionDecisionReason: "haven admission control",
			UpdatedInput:             input,
		},
	}
}

// admissionMessage is what the gate says about a decision, and it says nothing
// at all about the ordinary one. "haven: admitted" was printed above every
// gated command a session ran - forty-one of them in one turn on 2026-09-09 -
// and it carries no information: the command ran, which the caller can see. A
// line worth printing names something the caller did not already know and could
// act on, which is only true when the run was changed.
func admissionMessage(r rewrapRequest, workers int) string {
	switch r.decision {
	case domain.Narrow:
		return fmt.Sprintf("haven: narrowed to %d test workers - the machine is busy, so this runs at a width that fits", workers)
	case domain.Queue:
		return "haven: " + queueNote(r.queueDepth, r.estimatedWait, r.hasWaitEstimate)
	case domain.Background:
		return "haven: backgrounded, " + queueNote(r.queueDepth, r.estimatedWait, r.hasWaitEstimate) + " - the result arrives as a notification"
	case domain.Refuse:
		return "haven: refused"
	case domain.Admit:
		return ""
	}
	return ""
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

// havenPath is haven's own absolute path, because `make haven install` is
// optional and a rewrite that yields "command not found" would have broken a
// working command in the name of failing open.
func (o *Orchestrator) havenPath() string {
	if exe, err := os.Executable(); err == nil && exe != "" {
		return exe
	}
	return "haven"
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
