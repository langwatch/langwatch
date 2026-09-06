package app

import (
	"encoding/json"
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
	PermissionDecision       string         `json:"permissionDecision"`
	PermissionDecisionReason string         `json:"permissionDecisionReason,omitempty"`
	UpdatedInput             map[string]any `json:"updatedInput,omitempty"`
}

// deferReply is the neutral verdict: let the normal permission flow decide.
// It is what every failure path returns.
func deferReply() hookReply {
	return hookReply{Specific: hookSpecificOutput{
		HookEventName:      "PreToolUse",
		PermissionDecision: "defer",
	}}
}

// autoApprovingModes are the permission modes where a session already approves
// tool calls on its own.
//
// The gate may only REWRITE a command in one of these, because rewriting
// requires returning "allow" (measured: updatedInput is applied with allow and
// silently ignored with defer), and allow bypasses the permission system. In
// any other mode, approving would hand out an approval the user did not give,
// so the gate observes and may refuse but does not rewrite.
var autoApprovingModes = map[string]bool{
	"bypassPermissions": true,
	"acceptEdits":       true,
	"auto":              true,
	"dontAsk":           true,
}

// Gate reads one hook payload and writes one reply. It never returns an error:
// there is no failure here worth blocking an agent for.
func (o *Orchestrator) Gate(stdin io.Reader, stdout io.Writer) {
	reply := deferReply()
	defer func() {
		// A panic must not reach the runtime, which would exit 2 and block the
		// call. Recovering here converts any crash into a defer — and logs what it
		// caught, because a gate that panics on every call would otherwise degrade
		// to "defer" forever and nobody would ever learn. The log goes nowhere near
		// stdout, so saying so cannot affect the decision.
		if r := recover(); r != nil {
			o.log.Error("the gate panicked; deferring to the normal permission flow",
				zap.Any("panic", r), zap.ByteString("stack", debug.Stack()))
		}
		_ = json.NewEncoder(stdout).Encode(reply)
	}()

	var p hookPayload
	if json.NewDecoder(stdin).Decode(&p) != nil {
		return
	}
	if warning := o.cacheCostWarning(p); warning != "" {
		reply = hookReply{SystemMessage: warning, Specific: hookSpecificOutput{
			HookEventName:      "PreToolUse",
			PermissionDecision: "defer",
		}}
		return
	}
	if p.ToolName != "Bash" {
		return
	}
	command, _ := p.ToolInput["command"].(string)
	if command == "" || domain.AlreadyWrapped(command) {
		return
	}
	kind, heavy := domain.ClassifyCommand(command)
	if !heavy {
		return
	}

	reply = o.decideHeavy(p, command, kind)
}

// decideHeavy is the ladder for a command the gate has decided is heavy.
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
	case domain.Background, domain.Narrow, domain.Queue:
		// All three run under haven's slot; they differ in how the wrapped run
		// behaves. Rewriting needs an approval, so a session that still prompts is
		// left alone entirely.
		if !autoApprovingModes[p.PermissionMode] {
			return deferReply()
		}
		return o.rewrap(rewrapRequest{
			command:    command,
			decision:   decision,
			queueDepth: queueDepth,
			agentID:    p.AgentID,
			slots:      slots,
		})
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
	systemMessage := "haven: " + r.decision.String()

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

// slotState reports how many heavy runs are live and how many are allowed.
//
// The limit discounts what the compressor is already holding rather than
// trusting total RAM, because on a machine with a container VM holding several
// GiB os.totalmem() overstates what this process can have (ADR-090).
func (o *Orchestrator) slotState() slotState {
	return slotState{
		live:  o.store.HeavyRuns(),
		limit: domain.HeavySlots(o.sys.MemStat(), runtime.NumCPU()),
	}
}

// fullWidth is the width a unit run takes when nobody narrows it: half the
// cores, which is what platform/app/vitest.config.ts asks for with
// `maxWorkers: "50%"`.
func fullWidth() int { return max(runtime.NumCPU()/2, 1) }

// narrowedWidth is how many workers a narrowed run actually gets, and the two
// roads to Narrow want different arithmetic.
//
// With a slot free, the machine is loaded rather than full, and the reduction is
// a fixed fraction. With no slot free, the run is starting alongside everything
// already in flight, so it divides by them — sizing against the limit instead
// would let ten agents each start "narrowed" and rebuild the burst.
func (o *Orchestrator) narrowedWidth(s slotState) int {
	if s.free() {
		return domain.PressureWidth(fullWidth())
	}
	return domain.NarrowedWorkers(fullWidth(), s.live)
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
