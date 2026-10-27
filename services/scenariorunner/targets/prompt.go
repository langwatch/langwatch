package targets

import (
	"context"
	"regexp"
	"strings"

	scenario "github.com/langwatch/scenario/go"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// promptEngine renders prompt templates: sandboxed, nothing escaped.
var promptEngine = newSandboxedEngine(nil)

// PromptAgent answers with a configured prompt on the role's model
// (http.serialized-prompt-config.channel.ts).
type PromptAgent struct {
	config     PromptConfigData
	model      scenario.LLM
	modelName  string
	parameters *jsjson.Object
	logger     *zap.Logger
}

// PromptAgentOptions build a PromptAgent.
type PromptAgentOptions struct {
	Model      scenario.LLM
	ModelName  string
	Parameters *jsjson.Object
	Logger     *zap.Logger
}

// NewPromptAgent returns the adapter.
func NewPromptAgent(config PromptConfigData, opts PromptAgentOptions) *PromptAgent {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	return &PromptAgent{config: config, model: opts.Model, modelName: opts.ModelName, parameters: opts.Parameters, logger: logger}
}

// Name implements Agent.
func (a *PromptAgent) Name() string { return "SerializedPromptConfigAdapter" }

// Call implements Agent.
func (a *PromptAgent) Call(ctx context.Context, turn Turn) (string, error) {
	bindings, unbound := a.templateContext(turn)
	if len(unbound) > 0 {
		a.reportUnbound(ctx, unbound)
	}
	messages, err := a.renderMessages(bindings)
	if err != nil {
		return "", err
	}
	if !a.templateReadsConversation() {
		messages = append(messages, conversationMessages(turn.Messages)...)
	}
	params := scenario.InferenceParams{Model: a.modelName, Messages: messages, Temperature: a.config.Temperature}
	if a.config.MaxTokens != nil {
		n := int64(*a.config.MaxTokens)
		params.MaxTokens = &n
	}
	res, err := a.model.Inference(ctx, params)
	if err != nil {
		return "", err
	}
	return res.Message.Text(), nil
}

// renderMessages is the system prompt and the template messages, rendered.
func (a *PromptAgent) renderMessages(bindings map[string]any) ([]scenario.Message, error) {
	system, err := promptEngine.ParseAndRenderString(a.config.SystemPrompt, bindings)
	if err != nil {
		return nil, newError(err.Error())
	}
	messages := []scenario.Message{scenario.SystemMsg(system)}
	for _, m := range a.config.Messages {
		content, err := promptEngine.ParseAndRenderString(m.Content, bindings)
		if err != nil {
			return nil, newError(err.Error())
		}
		messages = append(messages, scenario.Message{Role: scenario.Role(m.Role), Content: content})
	}
	return messages, nil
}

func conversationMessages(messages []Message) []scenario.Message {
	out := make([]scenario.Message, 0, len(messages))
	for _, m := range messages {
		out = append(out, scenario.Message{Role: scenario.Role(m.Role), Content: m.TextContent()})
	}
	return out
}

// templateContext binds input, messages (prose), messagesJson, threadId,
// params and every declared input (prompt-template.rules.ts).
func (a *PromptAgent) templateContext(turn Turn) (map[string]any, []string) {
	transcript := transcriptForPrompt(turn.Messages)
	threadID := threadIDOr(turn.ThreadID)
	ctx := map[string]any{
		"input":        lastUserText(turn),
		"messages":     transcript,
		"messagesJson": sanitizedMessagesJSON(turn.Messages),
		"threadId":     threadID,
		"params":       toBindings(a.parameters),
	}
	effective := computeBestMatchMappings(a.config.Inputs).merged(&a.config.ScenarioMappings)
	sanitized := Turn{ThreadID: turn.ThreadID, Messages: sanitizedMessages(turn.Messages), NewMessages: turn.NewMessages}
	resolved := resolveFieldMappings(effective, sanitized, nil)
	for _, id := range effective.Keys {
		switch effective.Items[id].SourceField() {
		case "messages":
			ctx[id] = transcript
		case "threadId":
			ctx[id] = threadID
		default:
			ctx[id] = resolved[id]
		}
	}
	var unbound []string
	for _, in := range a.config.Inputs {
		if _, ok := resolved[in.Identifier]; !ok {
			unbound = append(unbound, in.Identifier)
			ctx[in.Identifier] = "[unbound input: " + in.Identifier + "]"
		}
	}
	return ctx, unbound
}

func (a *PromptAgent) reportUnbound(ctx context.Context, unbound []string) {
	trace.SpanFromContext(ctx).AddEvent("langwatch.prompt.unbound_inputs", trace.WithAttributes(
		attribute.String("langwatch.prompt.id", a.config.PromptID),
		attribute.String("langwatch.prompt.unbound_inputs", strings.Join(unbound, ", ")),
	))
	a.logger.Warn("Prompt declares input variables a simulation cannot bind",
		zap.String("promptId", a.config.PromptID), zap.Strings("unboundInputs", unbound))
}

// sanitizedMessages keep role and content only (#6590).
func sanitizedMessages(messages []Message) []Message {
	out := make([]Message, len(messages))
	for i, m := range messages {
		out[i] = Message{Role: m.Role, Content: m.Content, Raw: m.Raw}
	}
	return out
}

func sanitizedMessagesJSON(messages []Message) string {
	return string(MessagesJSON(sanitizedMessages(messages)))
}

// transcriptForPrompt is one `role: content` line per turn.
func transcriptForPrompt(messages []Message) string {
	lines := make([]string, len(messages))
	for i, m := range messages {
		lines[i] = m.Role + ": " + m.TextContent()
	}
	return strings.Join(lines, "\n")
}

var (
	liquidExpression = regexp.MustCompile(`\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}`)
	quotedLiteral    = regexp.MustCompile(`"[^"]*"|'[^']*'`)
	conversationVar  = regexp.MustCompile(`\b(messages|messagesJson)\b`)
)

// referencesConversation is a template reading the history in a Liquid
// expression, never the word in prose.
func referencesConversation(template string) bool {
	for _, expr := range liquidExpression.FindAllString(template, -1) {
		if conversationVar.MatchString(quotedLiteral.ReplaceAllString(expr, `""`)) {
			return true
		}
	}
	return false
}

func (a *PromptAgent) templateReadsConversation() bool {
	if referencesConversation(a.config.SystemPrompt) {
		return true
	}
	for _, m := range a.config.Messages {
		if referencesConversation(m.Content) {
			return true
		}
	}
	return false
}
