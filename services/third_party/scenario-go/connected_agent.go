package scenario

import (
	"context"
	"sync"
)

// ParameterValue is the value of one run parameter of a connected agent: a
// string, a number or a bool.
type ParameterValue = any

// ConnectedCall is one turn as the LangWatch connected agent contract sends
// it.
type ConnectedCall struct {
	Messages    []Message
	NewMessages []Message
	ThreadID    string
	// Session is what the function returned on the previous turn of the
	// thread; nil on the first.
	Session any
	// Params are the run parameters (ScenarioConfig.Parameters).
	Params map[string]ParameterValue
	// TraceID is the trace id of the current turn, or "".
	TraceID string
}

// ConnectedReply is the output of one turn plus the session to keep.
type ConnectedReply struct {
	Output *AgentReturn
	// Session, when non-nil, is sent back on the next turn of the thread.
	Session any
}

// ConnectedFunc is an agent written against the connected agent contract.
type ConnectedFunc func(ctx context.Context, call ConnectedCall) (ConnectedReply, error)

// ConnectedAgent runs a connected agent function as the agent under test,
// keeping the session it returns per thread like the platform does.
type ConnectedAgent struct {
	name        string
	environment string
	fn          ConnectedFunc
	mu          sync.Mutex
	sessions    map[string]any
}

// NewConnectedAgent wraps fn as the agent under test named name.
func NewConnectedAgent(name, environment string, fn ConnectedFunc) *ConnectedAgent {
	return &ConnectedAgent{name: name, environment: environment, fn: fn, sessions: map[string]any{}}
}

// Name implements Named.
func (a *ConnectedAgent) Name() string { return a.name }

// Environment returns the environment the agent was connected for.
func (a *ConnectedAgent) Environment() string { return a.environment }

// Role implements AgentAdapter.
func (a *ConnectedAgent) Role() AgentRole { return AgentRoleAgent }

// SessionFor returns the session held for a thread.
func (a *ConnectedAgent) SessionFor(threadID string) any {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessions[threadID]
}

// Call implements AgentAdapter.
func (a *ConnectedAgent) Call(ctx context.Context, in AgentInput) (*AgentReturn, error) {
	params := make(map[string]ParameterValue, len(in.ScenarioConfig.Parameters))
	for k, v := range in.ScenarioConfig.Parameters {
		params[k] = v
	}
	reply, err := a.fn(ctx, ConnectedCall{
		Messages:    in.Messages,
		NewMessages: in.NewMessages,
		ThreadID:    in.ThreadID,
		Session:     a.SessionFor(in.ThreadID),
		Params:      params,
		TraceID:     TraceIDFromHeaders(in.PropagationHeaders),
	})
	if err != nil {
		return nil, err
	}
	if reply.Session != nil {
		a.mu.Lock()
		a.sessions[in.ThreadID] = reply.Session
		a.mu.Unlock()
	}
	if reply.Output == nil {
		return TextReturn(""), nil
	}
	return reply.Output, nil
}
