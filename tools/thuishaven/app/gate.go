package app

import (
	"encoding/json"
	"io"
	"os"
	"runtime"
	"strings"
	"time"

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
		// call. Recovering here converts any crash into a defer.
		_ = recover()
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
	queueDepth, slotFree := o.queueState()

	decision := domain.DecideAdmission(domain.AdmissionRequest{
		Pressure:         level,
		SlotFree:         slotFree,
		Caller:           caller,
		Kind:             kind,
		ObservedDuration: o.observedDuration(command),
		CallerSetWorkers: domain.CallerSetWorkers(command),
		EstimatedWait:    o.estimatedWait(queueDepth, command),
		CanBackground:    autoApprovingModes[p.PermissionMode],
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
		// behaves, which `haven run` decides from the same state. Rewriting needs
		// an approval, so a session that still prompts is left alone entirely.
		if !autoApprovingModes[p.PermissionMode] {
			return deferReply()
		}
		return o.rewrap(command, decision, queueDepth)
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

// rewrap rewrites the command to run under haven's slot.
func (o *Orchestrator) rewrap(command string, decision domain.Admission, queueDepth int) hookReply {
	input := map[string]any{
		"command": domain.WrapCommand(o.havenPath(), command),
	}
	systemMessage := "haven: " + decision.String()

	if decision == domain.Background {
		input["run_in_background"] = true
		input["description"] = domain.BackgroundDescription(queueDepth)
	} else {
		// The tool's own timeout has to cover the admission wait as well as the
		// run. Only the WAIT is bounded by the cache window; capping total
		// runtime there would kill a long suite outright.
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

// queueState reports how many heavy runs are live and whether a slot is free.
//
// The limit comes from what is actually free rather than total RAM: on a
// machine with a container VM holding several GiB, os.totalmem() overstates
// what this process can have (ADR-090).
func (o *Orchestrator) queueState() (queueDepth int, slotFree bool) {
	live := o.store.HeavyRuns()
	limit := domain.HeavySlots(o.sys.MemStat(), runtime.NumCPU())
	if live < limit {
		return 0, true
	}
	// Position is how many are ahead, so a caller arriving behind `live` runs
	// with `limit` slots waits for (live - limit) + 1 of them to finish.
	return live - limit + 1, false
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
