// Package llm is the model a scenario run talks to: an OpenAI-compatible
// chat completion through the engine's LiteLLM proxy (/go/proxy/v1), with the
// role's LiteLLM params riding x-litellm-* headers, as the Node child's
// http.litellm-model.channel.ts builds it.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	scenario "github.com/langwatch/scenario/go"
)

// SecretHeader carries the engine hop's shared credential.
const SecretHeader = "X-LangWatch-NLP-Secret"

// reasoningOff is the value a provider asks for when it refuses tools with reasoning on.
const reasoningOff = "none"

// judgeModelsRequiringDisabledReasoning reject the judge's forced tool when
// reasoning is omitted (#6369); the judge turns it off up front for them.
var judgeModelsRequiringDisabledReasoning = map[string]bool{
	"openai/gpt-5.6-luna": true, "openai/gpt-5.6-sol": true, "openai/gpt-5.6-terra": true,
}

// Client is one role's model.
type Client struct {
	baseURL         string
	params          map[string]string
	secret          string
	reasoningEffort string
	http            *http.Client
}

// Options build a Client.
type Options struct {
	// Params are the role's LiteLLM params; `model` is required.
	Params map[string]string
	// NLPServiceURL is the engine the proxy lives on.
	NLPServiceURL string
	// Secret is the engine hop's shared credential; blank sends none.
	Secret string
	// HTTP posts the completions; nil uses http.DefaultClient.
	HTTP *http.Client
}

// New returns the model of a non-judge role.
func New(opts Options) *Client {
	client := opts.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	return &Client{
		baseURL: opts.NLPServiceURL + "/go/proxy/v1",
		params:  opts.Params,
		secret:  strings.TrimSpace(opts.Secret),
		http:    client,
	}
}

// NewJudge returns the judge's model: the same, with reasoning off for the
// models known to refuse a forced tool otherwise.
func NewJudge(opts Options) *Client {
	c := New(opts)
	if judgeModelsRequiringDisabledReasoning[opts.Params["model"]] && strings.Contains(opts.Params["model"], "/") {
		c.reasoningEffort = reasoningOff
	}
	return c
}

// Model is the model name the role runs on.
func (c *Client) Model() string { return c.params["model"] }

// Inference implements scenario.LLM.
func (c *Client) Inference(ctx context.Context, p scenario.InferenceParams) (*scenario.InferenceResult, error) {
	body := c.requestBody(p)
	status, raw, err := c.post(ctx, body)
	if err != nil {
		return nil, err
	}
	if status == http.StatusBadRequest && retryEligible(body) && asksForReasoningOff(raw) {
		body["reasoning_effort"] = reasoningOff
		status, raw, err = c.post(ctx, body)
		if err != nil {
			return nil, err
		}
	}
	if status < 200 || status >= 300 {
		return nil, apiError(status, raw)
	}
	return parseCompletion(raw)
}

func (c *Client) requestBody(p scenario.InferenceParams) map[string]any {
	model := p.Model
	if model == "" {
		model = c.Model()
	}
	body := map[string]any{"model": model, "messages": toWireMessages(p.Messages)}
	if p.Temperature != nil {
		body["temperature"] = *p.Temperature
	}
	if p.MaxTokens != nil {
		body["max_tokens"] = *p.MaxTokens
	}
	if len(p.Tools) > 0 {
		body["tools"] = toWireTools(p.Tools)
	}
	if p.ToolChoice != nil {
		body["tool_choice"] = toWireToolChoice(p.ToolChoice)
	}
	if c.reasoningEffort != "" {
		body["reasoning_effort"] = c.reasoningEffort
	}
	return body
}

func (c *Client) post(ctx context.Context, body map[string]any) (int, []byte, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(encoded))
	if err != nil {
		return 0, nil, err
	}
	c.setHeaders(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, callError("Cannot connect to API: " + err.Error())
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	return resp.StatusCode, raw, err
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	if key := c.params["api_key"]; key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	for k, v := range c.params {
		req.Header.Set("x-litellm-"+k, v)
	}
	if c.secret != "" {
		req.Header.Set(SecretHeader, c.secret)
	}
}

// retryEligible is a tool-carrying request with no reasoning effort of its own.
func retryEligible(body map[string]any) bool {
	tools, _ := body["tools"].([]map[string]any)
	_, hasEffort := body["reasoning_effort"]
	return len(tools) > 0 && !hasEffort
}

// asksForReasoningOff is a 400 about reasoning_effort whose remediation quotes 'none'.
func asksForReasoningOff(raw []byte) bool {
	var parsed struct {
		Error *struct {
			Message string `json:"message"`
			Param   string `json:"param"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &parsed) != nil || parsed.Error == nil {
		return false
	}
	about := parsed.Error.Param == "reasoning_effort" || strings.Contains(parsed.Error.Message, "reasoning_effort")
	quoted := strings.Contains(parsed.Error.Message, "'none'") || strings.Contains(parsed.Error.Message, `"none"`)
	return about && quoted
}

// apiError is the provider's own message when it sent one.
func apiError(status int, raw []byte) error {
	var parsed struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &parsed) == nil && parsed.Error != nil && parsed.Error.Message != "" {
		return errors.New(parsed.Error.Message)
	}
	if text := strings.TrimSpace(string(raw)); text != "" {
		return errors.New(text)
	}
	return errors.New(http.StatusText(status))
}

type wireCompletion struct {
	Choices []struct {
		Message struct {
			Content   *string `json:"content"`
			ToolCalls []struct {
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
	} `json:"usage"`
}

func parseCompletion(raw []byte) (*scenario.InferenceResult, error) {
	var c wireCompletion
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, callError("Invalid JSON response: " + err.Error())
	}
	if len(c.Choices) == 0 {
		return nil, callError("No response content from LLM")
	}
	choice := c.Choices[0].Message
	msg := scenario.Message{Role: scenario.RoleAssistant}
	if choice.Content != nil {
		msg.Content = *choice.Content
	}
	for _, tc := range choice.ToolCalls {
		msg.ToolCalls = append(msg.ToolCalls, scenario.ToolCall{ID: tc.ID, Name: tc.Function.Name, Arguments: tc.Function.Arguments})
	}
	res := &scenario.InferenceResult{Message: msg}
	if c.Usage != nil {
		res.Usage = &scenario.Usage{InputTokens: c.Usage.PromptTokens, OutputTokens: c.Usage.CompletionTokens}
	}
	return res, nil
}

// callError is a failed call worded as the AI SDK words it, capitals and all.
type callError string

func (e callError) Error() string { return string(e) }
