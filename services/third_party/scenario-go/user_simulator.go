package scenario

import (
	"context"
	"errors"
	"slices"
	"strings"
)

// UserSimulatorAgentConfig configures the user simulator.
type UserSimulatorAgentConfig struct {
	// Name is reported to LangWatch; defaults to "UserSimulatorAgent".
	Name string
	// ModelConfig selects the model; unset fields fall back to
	// Configure(WithDefaultModel(...)).
	ModelConfig
	// SystemPrompt replaces the built-in prompt.
	SystemPrompt string
	// Persona is appended to the built-in prompt to shape the simulated user.
	Persona string
}

// UserSimulatorAgent plays the user, generating messages from the scenario
// description. It never streams; voice extensions turn its text into audio.
type UserSimulatorAgent struct {
	cfg     UserSimulatorAgentConfig
	invoker invoker
}

// NewUserSimulatorAgent returns a user simulator.
func NewUserSimulatorAgent(cfg UserSimulatorAgentConfig) *UserSimulatorAgent {
	return &UserSimulatorAgent{cfg: cfg, invoker: invoker{role: AgentRoleUser}}
}

// Role implements AgentAdapter.
func (u *UserSimulatorAgent) Role() AgentRole { return AgentRoleUser }

// Name implements Named.
func (u *UserSimulatorAgent) Name() string {
	if u.cfg.Name != "" {
		return u.cfg.Name
	}
	return "UserSimulatorAgent"
}

// buildUserSimulatorPrompt is the JS simulator's system prompt.
func buildUserSimulatorPrompt(description, persona string) string {
	personaBlock := ""
	if persona != "" {
		personaBlock = "\n\n<persona>\n" + persona + "\n</persona>\n"
	}
	return strings.TrimSpace(`
<role>
You are pretending to be a user, you are testing an AI Agent (shown as the user role) based on a scenario.
Approach this naturally, as a human user would, with very short inputs, few words, all lowercase, imperative, not periods, like when they google or talk to chatgpt.
</role>

<goal>
Your goal (assistant) is to interact with the Agent Under Test (user) as if you were a human user to see if it can complete the scenario successfully.
</goal>

<scenario>
` + description + `
</scenario>

<rules>
- DO NOT carry over any requests yourself, YOU ARE NOT the assistant today, you are the user
</rules>
` + personaBlock)
}

// maxEmptyCompletionAttempts is how often an empty answer is retried.
const maxEmptyCompletionAttempts = 3

// errNoUserContent is the error the platform classifies; keep it verbatim.
//
//lint:ignore ST1005 the platform matches the JS SDK's exact message
var errNoUserContent = errors.New("No response content from LLM")

// Call implements AgentAdapter.
func (u *UserSimulatorAgent) Call(ctx context.Context, in AgentInput) (*AgentReturn, error) {
	system := u.cfg.SystemPrompt
	if system == "" {
		system = buildUserSimulatorPrompt(in.ScenarioConfig.Description, u.cfg.Persona)
	}
	model, err := u.cfg.ModelConfig.merged(currentSettings().DefaultModel)
	if err != nil {
		return nil, err
	}
	history := in.Messages
	if in.Executor != nil && hasAudioWithoutTranscript(history) {
		// The executor hands the simulator a view of the stored
		// conversation; extensions get a copy they may modify.
		history = slices.Clone(history)
		for _, p := range in.Executor.hooks.userSimInput {
			prepared, err := p.PreprocessUserSimulatorInput(ctx, in.Executor, history)
			if err != nil {
				logger().Warn("user simulator input preprocessing failed; continuing with the original messages", "error", err.Error())
				break
			}
			history = prepared
		}
	}
	// One slice for the whole prompt: audio stripped and roles reversed in
	// place, message by message.
	msgs := make([]Message, 0, len(history)+2)
	msgs = append(msgs, SystemMsg(system), AssistantMsg("Hello, how can I help you today"))
	for _, m := range history {
		msgs = append(msgs, stripAudioMessage(m))
	}
	var names map[string]string
	for i, m := range msgs {
		if m.Role == RoleTool && m.ToolName == "" && names == nil {
			names = toolNamesByCallID(history)
		}
		msgs[i] = reverseRole(m, names)
	}
	params := InferenceParams{
		Model:       model.Model,
		Messages:    msgs,
		Temperature: model.Temperature,
		MaxTokens:   model.MaxTokens,
	}
	// An empty answer is usually transient; ask again before failing.
	for attempt := 1; attempt <= maxEmptyCompletionAttempts; attempt++ {
		res, err := u.invoker.invoke(ctx, model.LLM, params)
		if err != nil {
			return nil, err
		}
		if text := res.Message.Text(); text != "" {
			return MessageReturn(UserMsg(text)), nil
		}
		if attempt < maxEmptyCompletionAttempts {
			logger().Warn("the model returned no content; asking again", "attempt", attempt)
		}
	}
	return nil, errNoUserContent
}

// hasAudioWithoutTranscript reports whether a message carries audio but no
// text, which would reach the text model as a bare placeholder.
func hasAudioWithoutTranscript(msgs []Message) bool {
	for _, m := range msgs {
		if m.HasAudio() && strings.TrimSpace(m.Text()) == "" {
			return true
		}
	}
	return false
}

// stripAudioMessage prepares an audio message for a text-only model: its text
// parts are kept (an assistant turn with audio and text is reframed as
// "[the agent said: …]" so the simulator does not parrot it), and an
// audio-only message becomes "[audio message]". Other messages pass
// through.
func stripAudioMessage(m Message) Message {
	if !m.HasAudio() {
		return m
	}
	var texts []string
	for _, p := range m.Parts {
		if p.Type == PartText {
			texts = append(texts, p.Text)
		}
	}
	stripped := m
	stripped.Parts = nil
	switch {
	case len(texts) == 0:
		stripped.Content = "[audio message]"
	case m.Role == RoleAssistant:
		stripped.Content = "[the agent said: " + strings.Join(texts, " ") + "]"
	default:
		stripped.Content = strings.Join(texts, " ")
	}
	return stripped
}

// reverseRole swaps user and assistant for the simulator, because models
// are biased to answer as the assistant. Tool calls and results become
// plain-text summaries on the user side. A tool result without a ToolName
// (as ToolMsg builds it) is named after the assistant call it answers, from
// names (toolNamesByCallID of the conversation).
func reverseRole(m Message, names map[string]string) Message {
	switch {
	case m.Role == RoleTool:
		name := resultToolName(m, names)
		if name == "" {
			name = "unknown tool"
		}
		return UserMsg("[Tool result from " + name + ": " + m.Text() + "]")
	case m.Role == RoleAssistant && len(m.ToolCalls) > 0:
		lines := make([]string, len(m.ToolCalls))
		for i, tc := range m.ToolCalls {
			lines[i] = "[Called tool " + tc.Name + " with: " + string(appendToolInput(nil, tc.Arguments)) + "]"
		}
		return UserMsg(strings.Join(lines, "\n"))
	case m.Role == RoleAssistant:
		m.Role = RoleUser
	case m.Role == RoleUser:
		m.Role = RoleAssistant
	}
	return m
}
