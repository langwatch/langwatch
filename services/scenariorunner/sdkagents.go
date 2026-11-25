package scenariorunner

import (
	"context"

	scenario "github.com/langwatch/scenario/go"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
	"github.com/langwatch/langwatch/services/scenariorunner/targets"
)

// targetAgent puts a target adapter under test in a scenario run. A failure
// is wrapped "[Name] ErrorName: message", as the JS SDK wraps an agent's error.
type targetAgent struct {
	target targets.Agent
}

// Role implements scenario.AgentAdapter.
func (a *targetAgent) Role() scenario.AgentRole { return scenario.AgentRoleAgent }

// Name implements scenario.Named.
func (a *targetAgent) Name() string { return a.target.Name() }

// Call implements scenario.AgentAdapter.
func (a *targetAgent) Call(ctx context.Context, in scenario.AgentInput) (*scenario.AgentReturn, error) {
	reply, err := a.target.Call(ctx, turnOf(in))
	if err != nil {
		return nil, &targets.Error{Name: "Error", Message: "[" + a.target.Name() + "] " + targets.ToString(err), Cause: err}
	}
	return scenario.TextReturn(reply), nil
}

// The SDK names an agent's span after its Go type, as the JS SDK names it
// after the class, so each target gets a type of its own name.
type (
	// SerializedHttpAgentAdapter is the span name of an HTTP target turn.
	SerializedHttpAgentAdapter struct{ targetAgent }
	// SerializedPromptConfigAdapter is the span name of a prompt target turn.
	SerializedPromptConfigAdapter struct{ targetAgent }
	// SerializedCodeAgentAdapter is the span name of a code target turn.
	SerializedCodeAgentAdapter struct{ targetAgent }
	// SerializedWorkflowAgentAdapter is the span name of a workflow target turn.
	SerializedWorkflowAgentAdapter struct{ targetAgent }
	// SerializedConnectedAgentAdapter is the span name of a connected target turn.
	SerializedConnectedAgentAdapter struct{ targetAgent }
)

// sdkAgentFor wraps a target in the type its spans are named after.
func sdkAgentFor(kind string, target targets.Agent) scenario.AgentAdapter {
	base := targetAgent{target: target}
	switch kind {
	case "http":
		return &SerializedHttpAgentAdapter{base}
	case "prompt":
		return &SerializedPromptConfigAdapter{base}
	case "code":
		return &SerializedCodeAgentAdapter{base}
	case "workflow":
		return &SerializedWorkflowAgentAdapter{base}
	case "connected":
		return &SerializedConnectedAgentAdapter{base}
	}
	return &base
}

// scriptedUserAgent fills the user role of a scripted run and refuses to
// improvise, so a script that runs out of lines fails.
type scriptedUserAgent struct{}

// ScriptedUserAgent is the name the JS script gives this agent.
func (scriptedUserAgent) Name() string { return "ScriptedUserAgent" }

// Role implements scenario.AgentAdapter.
func (scriptedUserAgent) Role() scenario.AgentRole { return scenario.AgentRoleUser }

// Call implements scenario.AgentAdapter.
func (scriptedUserAgent) Call(context.Context, scenario.AgentInput) (*scenario.AgentReturn, error) {
	return nil, &targets.Error{Name: "Error", Message: "The scripted user has no more lines; every user turn of an agent test is written down"}
}

// turnOf converts the SDK's input into the adapters' turn.
func turnOf(in scenario.AgentInput) targets.Turn {
	return targets.Turn{ThreadID: in.ThreadID, Messages: messagesOf(in.Messages), NewMessages: messagesOf(in.NewMessages)}
}

func messagesOf(ms []scenario.Message) []targets.Message {
	out := make([]targets.Message, len(ms))
	for i := range ms {
		m := &ms[i]
		turn := m.Turn
		out[i] = targets.Message{Role: string(m.Role), ID: m.ID, TraceID: m.TraceID, Turn: &turn}
		if isPlainText(m) {
			out[i].Content = m.Text()
		} else {
			out[i].Raw = jsjson.Raw(jsjson.Stringify(contentParts(m)))
		}
	}
	return out
}

func isPlainText(m *scenario.Message) bool {
	return m.Role == scenario.RoleSystem || (len(m.Parts) == 0 && len(m.ToolCalls) == 0 && m.Role != scenario.RoleTool)
}

// contentParts is a message's content in the AI SDK part shape.
func contentParts(m *scenario.Message) []any {
	if m.Role == scenario.RoleTool {
		output := jsjson.NewObject().Set("type", "text").Set("value", m.Text())
		return []any{jsjson.NewObject().Set("type", "tool-result").Set("toolCallId", m.ToolCallID).
			Set("toolName", m.ToolName).Set("output", output)}
	}
	var parts []any
	if len(m.Parts) == 0 && m.Content != "" {
		parts = append(parts, jsjson.NewObject().Set("type", "text").Set("text", m.Content))
	}
	for i := range m.Parts {
		p := &m.Parts[i]
		if p.Type == scenario.PartText {
			parts = append(parts, jsjson.NewObject().Set("type", "text").Set("text", p.Text))
			continue
		}
		parts = append(parts, jsjson.NewObject().Set("type", string(p.Type)).Set("mediaType", p.MediaType))
	}
	for _, tc := range m.ToolCalls {
		input, err := jsjson.Parse([]byte(tc.Arguments))
		if err != nil {
			input = tc.Arguments
		}
		parts = append(parts, jsjson.NewObject().Set("type", "tool-call").Set("toolCallId", tc.ID).
			Set("toolName", tc.Name).Set("input", input))
	}
	return parts
}
