package scenario

import (
	"context"
	"reflect"
	"strings"
)

// AgentRole is the part an agent plays in a scenario.
type AgentRole string

// Agent roles.
const (
	AgentRoleUser  AgentRole = "User"
	AgentRoleAgent AgentRole = "Agent"
	AgentRoleJudge AgentRole = "Judge"
)

// turnRoleOrder is the order roles act in within one turn.
var turnRoleOrder = [...]AgentRole{AgentRoleUser, AgentRoleAgent, AgentRoleJudge}

func (r AgentRole) valid() bool {
	return r == AgentRoleUser || r == AgentRoleAgent || r == AgentRoleJudge
}

// AgentAdapter integrates an agent with a scenario: the agent under test, a
// user simulator, or a judge. Call may run concurrently with other script
// steps when the executor starts a non-blocking turn.
type AgentAdapter interface {
	// Role is the role the agent plays.
	Role() AgentRole
	// Call produces the agent's response for one turn. The context carries the
	// agent's OpenTelemetry span, so spans the agent starts nest under it.
	Call(ctx context.Context, input AgentInput) (*AgentReturn, error)
}

// Named is implemented by agents that report a name to LangWatch. Without
// it, or with a blank name, the agent's Go type name is used.
type Named interface {
	Name() string
}

// JudgmentRequest asks the judge for a verdict, optionally on inline criteria
// that override its configured ones.
type JudgmentRequest struct {
	// Criteria, when non-nil, replace the judge's configured criteria.
	Criteria []string
	// AdditionalContext is shown to the judge under <additional_context>, for
	// example filesystem state or command output gathered by a custom step.
	AdditionalContext string
}

// AgentInput is what an agent receives on each call.
type AgentInput struct {
	// ThreadID identifies the conversation.
	ThreadID string
	// Messages is the full conversation so far. The slice is the caller's
	// copy; agents may keep or modify it.
	Messages []Message
	// NewMessages are the messages added since this agent last acted.
	NewMessages []Message
	// RequestedRole is the role the agent is asked to play.
	RequestedRole AgentRole
	// JudgmentRequest is set when a verdict is required (judge agents).
	JudgmentRequest *JudgmentRequest
	// PropagationHeaders holds W3C trace context headers (traceparent,
	// tracestate) for the agent call span. HTTP adapters forward them so the
	// remote agent's spans join the turn's trace.
	PropagationHeaders map[string]string
	// ScenarioState is the live execution state.
	ScenarioState *ExecutionState
	// ScenarioConfig is the scenario configuration with defaults applied.
	ScenarioConfig ScenarioConfig
	// Executor is the running executor, for extensions that need its
	// per-run values. Agents must not drive the script from inside Call.
	Executor *Executor
	// Stream reports progress (text deltas, tool calls) while the agent
	// produces its message, when granular events are on. It is nil, and its
	// methods no-ops, otherwise. The returned message stays authoritative.
	Stream *MessageStream
}

// AgentReturn is the response of an agent call: text, messages, or a judge
// verdict. A nil *AgentReturn means "nothing to add" (a judge continuing).
type AgentReturn struct {
	text     string
	hasText  bool
	messages []Message
	verdict  *JudgeResult
}

// TextReturn returns text, recorded as a message in the role the agent plays.
func TextReturn(text string) *AgentReturn { return &AgentReturn{text: text, hasText: true} }

// MessageReturn returns one message.
func MessageReturn(m Message) *AgentReturn { return &AgentReturn{messages: []Message{m}} }

// MessagesReturn returns several messages, for example tool calls and results.
func MessagesReturn(ms ...Message) *AgentReturn { return &AgentReturn{messages: ms} }

// VerdictReturn returns a judge verdict, which ends the scenario.
func VerdictReturn(r JudgeResult) *AgentReturn { return &AgentReturn{verdict: &r} }

// Verdict returns the judge verdict carried, if any.
func (r *AgentReturn) Verdict() (*JudgeResult, bool) {
	if r == nil || r.verdict == nil {
		return nil, false
	}
	return r.verdict, true
}

// Messages converts the return to messages, using role for text returns.
func (r *AgentReturn) Messages(role Role) []Message {
	switch {
	case r == nil:
		return nil
	case r.hasText:
		return []Message{{Role: role, Content: r.text}}
	}
	return r.messages
}

// AgentFunc adapts a function to the agent-under-test role.
type AgentFunc func(ctx context.Context, input AgentInput) (*AgentReturn, error)

// Role implements AgentAdapter.
func (AgentFunc) Role() AgentRole { return AgentRoleAgent }

// Call implements AgentAdapter.
func (f AgentFunc) Call(ctx context.Context, input AgentInput) (*AgentReturn, error) {
	return f(ctx, input)
}

// agentName resolves the name a run reports for an agent: its own trimmed
// name, else its Go type name; empty for anonymous adapters such as
// AgentFunc, which the run then leaves out of the agent list.
func agentName(a AgentAdapter) string {
	if n, ok := a.(Named); ok {
		if name := strings.TrimSpace(n.Name()); name != "" {
			return name
		}
	}
	return typeName(a)
}

// typeName is the Go type name of an adapter, or empty for AgentFunc and
// unnamed types.
func typeName(a AgentAdapter) string {
	if _, ok := a.(AgentFunc); ok {
		return ""
	}
	t := reflect.TypeOf(a)
	for t != nil && t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t == nil {
		return ""
	}
	return t.Name()
}

// agentSpanName is the name of the span around an agent call: the adapter's
// type name, like the class name the JS SDK uses.
func agentSpanName(a AgentAdapter) string {
	name := typeName(a)
	if name == "" {
		name = "Agent"
	}
	return name + ".call"
}
