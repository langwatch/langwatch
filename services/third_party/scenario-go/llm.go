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
//
// Either set LLM to a provider (openai.NewProvider(&client), …) and Model to
// that provider's model name, or leave LLM nil and set Model to a
// "provider/model" string such as "openai/gpt-4.1-mini", the format of the
// JS and Python SDKs. The provider part is looked up among the providers
// registered with RegisterProvider, which read their API keys from the
// environment unless APIKey is set.
type ModelConfig struct {
	LLM   LLM
	Model string
	// Temperature is left to the provider default when nil, which keeps
	// reasoning models that reject it working.
	Temperature *float64
	MaxTokens   *int64
	// APIKey, BaseURL and Headers configure the provider a "provider/model"
	// string resolves to; empty fields fall back to its environment
	// variables. They are ignored when LLM is set.
	APIKey  string
	BaseURL string
	Headers map[string]string
}

// WithDefaults returns c with unset fields taken from defaults, the way the
// built-in agents combine their own model with Configure(WithDefaultModel).
//
// A Model naming a registered provider ("anthropic/claude-sonnet-4-5")
// stands on its own: it does not inherit the default LLM, nor the default's
// key and endpoint unless both name the same provider. A bare model name
// ("gpt-4.1") keeps the default's provider.
func (c ModelConfig) WithDefaults(defaults ModelConfig) ModelConfig {
	switch {
	case c.Model == "":
		c.Model = defaults.Model
		if c.LLM == nil {
			c.LLM = defaults.LLM
		}
		c.inheritEndpoint(defaults)
	case c.LLM != nil:
	case registeredProvider(c.Model) != "":
		if registeredProvider(c.Model) == registeredProvider(defaults.Model) {
			c.inheritEndpoint(defaults)
		}
	default:
		c.LLM = defaults.LLM
		if c.LLM == nil {
			if p := registeredProvider(defaults.Model); p != "" {
				c.Model = p + "/" + c.Model
			}
		}
		c.inheritEndpoint(defaults)
	}
	if c.Temperature == nil {
		c.Temperature = defaults.Temperature
	}
	if c.MaxTokens == nil {
		c.MaxTokens = defaults.MaxTokens
	}
	return c
}

func (c *ModelConfig) inheritEndpoint(defaults ModelConfig) {
	if c.APIKey == "" {
		c.APIKey = defaults.APIKey
	}
	if c.BaseURL == "" {
		c.BaseURL = defaults.BaseURL
	}
	if c.Headers == nil {
		c.Headers = defaults.Headers
	}
}

// merged combines c with the defaults and resolves a "provider/model"
// string to its LLM.
func (c ModelConfig) merged(defaults ModelConfig) (ModelConfig, error) {
	return c.WithDefaults(defaults).Resolve()
}

// ErrNoModel is returned when neither the agent nor Configure provides an LLM.
var ErrNoModel = errors.New("a model is required: set LLM or a \"provider/model\" Model on the agent config, or call scenario.Configure(scenario.WithDefaultModel(...))")

// errNilInference is returned when an LLM reports neither a result nor an
// error, which the agents would otherwise dereference.
var errNilInference = errors.New("the model returned neither a result nor an error")

// invoker calls an LLM and learns, per agent, which request features the
// provider rejects: a forced tool choice or a temperature. On such an error
// the call is retried once with the feature adapted, and later calls apply
// the adaptation up front, like the JS SDK's createLLMInvoker. Every
// attempt is recorded as an LLM span (see TraceInference).
type invoker struct {
	// role is the scenario role recorded on the model-call spans; the judge
	// sets it so it can tell its own calls apart in the trace.
	role            AgentRole
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
		res, err := traceInference(ctx, llm, adapted, iv.role)
		if err == nil {
			if res == nil {
				return nil, errNilInference
			}
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
