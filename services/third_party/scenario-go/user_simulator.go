package scenario

import (
	"context"
	"errors"
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
	return &UserSimulatorAgent{cfg: cfg}
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
var errNoUserContent = errors.New("No response content from LLM")

// Call implements AgentAdapter.
func (u *UserSimulatorAgent) Call(ctx context.Context, in AgentInput) (*AgentReturn, error) {
	system := u.cfg.SystemPrompt
	if system == "" {
		system = buildUserSimulatorPrompt(in.ScenarioConfig.Description, u.cfg.Persona)
	}
	model := u.cfg.ModelConfig.merged(currentSettings().DefaultModel)
	if model.LLM == nil {
		return nil, ErrNoModel
	}
	history := in.Messages
	if in.Executor != nil && hasAudioWithoutTranscript(history) {
		for _, p := range in.Executor.hooks.userSimInput {
			prepared, err := p.PreprocessUserSimulatorInput(ctx, in.Executor, history)
			if err != nil {
				logger().Warn("user simulator input preprocessing failed; continuing with the original messages", "error", err.Error())
				break
			}
			history = prepared
		}
	}
	msgs := make([]Message, 0, len(history)+2)
	msgs = append(msgs, SystemMsg(system), AssistantMsg("Hello, how can I help you today"))
	msgs = append(msgs, stripAudio(history)...)
	params := InferenceParams{
		Model:       model.Model,
		Messages:    reverseRoles(msgs),
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

// stripAudio prepares audio messages for a text-only model: their text
// parts are kept (an assistant turn with audio and text is reframed as
// "[the agent said: …]" so the simulator does not parrot it), and an
// audio-only message becomes "[audio message]". Other messages pass through.
func stripAudio(msgs []Message) []Message {
	out := make([]Message, len(msgs))
	for i, m := range msgs {
		if !m.HasAudio() {
			out[i] = m
			continue
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
		out[i] = stripped
	}
	return out
}

// reverseRoles swaps user and assistant for the simulator, because models
// are biased to answer as the assistant. Tool calls and results become
// plain-text summaries on the user side.
func reverseRoles(msgs []Message) []Message {
	out := make([]Message, 0, len(msgs))
	for _, m := range msgs {
		switch {
		case m.Role == RoleTool:
			name := m.ToolName
			if name == "" {
				name = "unknown tool"
			}
			out = append(out, UserMsg("[Tool result from "+name+": "+m.Text()+"]"))
		case m.Role == RoleAssistant && len(m.ToolCalls) > 0:
			lines := make([]string, len(m.ToolCalls))
			for i, tc := range m.ToolCalls {
				lines[i] = "[Called tool " + tc.Name + " with: " + string(appendToolInput(nil, tc.Arguments)) + "]"
			}
			out = append(out, UserMsg(strings.Join(lines, "\n")))
		case m.Role == RoleAssistant:
			r := m
			r.Role = RoleUser
			out = append(out, r)
		case m.Role == RoleUser:
			r := m
			r.Role = RoleAssistant
			out = append(out, r)
		default:
			out = append(out, m)
		}
	}
	return out
}
