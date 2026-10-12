package scenario

import (
	"context"
	"errors"
	"strings"
	"sync"
)

// LLM is a chat completion provider. Implementations live in the provider
// modules (providers/openai, providers/anthropic, …) or in user code.
type LLM interface {
	Inference(ctx context.Context, params InferenceParams) (*InferenceResult, error)
}

// InferenceParams is one chat completion request.
type InferenceParams struct {
	Model       string
	Messages    []Message
	Temperature *float64
	MaxTokens   *int64
	Tools       []ToolDefinition
	ToolChoice  *ToolChoice
}

// ToolDefinition describes a tool the model may call.
type ToolDefinition struct {
	Name        string
	Description string
	// Parameters is the JSON Schema of the argument object.
	Parameters map[string]any
	// Strict asks providers that support it for strict schema adherence.
	Strict bool
}

// ToolChoiceType selects how the model uses tools.
type ToolChoiceType string

// Tool choice modes.
const (
	ToolChoiceAuto     ToolChoiceType = "auto"
	ToolChoiceRequired ToolChoiceType = "required"
	ToolChoiceNone     ToolChoiceType = "none"
	ToolChoiceTool     ToolChoiceType = "tool"
)

// ToolChoice controls tool use. With Type ToolChoiceTool the model must call
// ToolName.
type ToolChoice struct {
	Type     ToolChoiceType
	ToolName string
}

// RequireTool forces a call of the named tool.
func RequireTool(name string) *ToolChoice { return &ToolChoice{Type: ToolChoiceTool, ToolName: name} }

// Usage is the token usage of a completion, when the provider reports it.
type Usage struct {
	InputTokens  int64
	OutputTokens int64
}

// InferenceResult is the model's answer.
type InferenceResult struct {
	Message Message
	Usage   *Usage
}

// ModelConfig selects a model and its sampling settings.
type ModelConfig struct {
	LLM   LLM
	Model string
	// Temperature is left to the provider default when nil, which keeps
	// reasoning models that reject it working.
	Temperature *float64
	MaxTokens   *int64
}

// merged returns c with unset fields taken from defaults.
func (c ModelConfig) merged(defaults ModelConfig) ModelConfig {
	if c.LLM == nil {
		c.LLM = defaults.LLM
	}
	if c.Model == "" {
		c.Model = defaults.Model
	}
	if c.Temperature == nil {
		c.Temperature = defaults.Temperature
	}
	if c.MaxTokens == nil {
		c.MaxTokens = defaults.MaxTokens
	}
	return c
}

// ErrNoModel is returned when neither the agent nor Configure provides an LLM.
var ErrNoModel = errors.New("a model is required: set LLM on the agent config or call scenario.Configure(scenario.WithDefaultModel(...))")

// invoker calls an LLM and learns, per agent, which request features the
// provider rejects: a forced tool choice or a temperature. On such an error
// the call is retried once with the feature adapted, and later calls apply
// the adaptation up front, like the JS SDK's createLLMInvoker.
type invoker struct {
	mu              sync.Mutex
	relaxToolChoice bool
	dropTemperature bool
}

// containsAny reports whether s contains any of the substrings.
func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func (iv *invoker) invoke(ctx context.Context, llm LLM, params InferenceParams) (*InferenceResult, error) {
	if llm == nil {
		return nil, ErrNoModel
	}
	for {
		adapted := iv.apply(params)
		res, err := llm.Inference(ctx, adapted)
		if err == nil {
			return res, nil
		}
		if !iv.learn(err, adapted) {
			return nil, err
		}
		logger().Warn("the model rejected the call, retrying with an adapted request", "error", err.Error())
	}
}

func (iv *invoker) learn(err error, p InferenceParams) bool {
	text := strings.ToLower(err.Error())
	iv.mu.Lock()
	defer iv.mu.Unlock()
	if !iv.relaxToolChoice && forcesTool(p.ToolChoice) && strings.Contains(text, "tool_choice") && containsAny(text, "not supported", "forces tool use") {
		iv.relaxToolChoice = true
		return true
	}
	if !iv.dropTemperature && p.Temperature != nil && strings.Contains(text, "temperature") && containsAny(text, "deprecated", "not support", "unsupported", "only the default") {
		iv.dropTemperature = true
		return true
	}
	return false
}

func forcesTool(c *ToolChoice) bool {
	return c != nil && (c.Type == ToolChoiceRequired || c.Type == ToolChoiceTool)
}

func (iv *invoker) apply(p InferenceParams) InferenceParams {
	iv.mu.Lock()
	relax, drop := iv.relaxToolChoice, iv.dropTemperature
	iv.mu.Unlock()
	if drop {
		p.Temperature = nil
	}
	if relax && forcesTool(p.ToolChoice) {
		instruction := "Answer only by calling one of the provided tools, never with plain text."
		if p.ToolChoice.Type == ToolChoiceTool {
			instruction = "Answer only by calling the " + p.ToolChoice.ToolName + " tool, never with plain text."
		}
		msgs := make([]Message, len(p.Messages), len(p.Messages)+1)
		copy(msgs, p.Messages)
		p.Messages = append(msgs, UserMsg(instruction))
		p.ToolChoice = &ToolChoice{Type: ToolChoiceAuto}
	}
	return p
}

// toolCallNamed returns the first tool call of the message with the name.
func toolCallNamed(m Message, name string) (ToolCall, bool) {
	for _, tc := range m.ToolCalls {
		if strings.EqualFold(tc.Name, name) {
			return tc, true
		}
	}
	return ToolCall{}, false
}
