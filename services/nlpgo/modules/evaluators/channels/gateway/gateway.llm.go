// Package gateway is the LLMChannel over the AI gateway's in-process
// dispatcher. Credentials come from the tenant's request env only, translated
// by pkg/litellmparams exactly as the studio does. Plan: §3.1, §5.2.
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/litellmparams"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
)

const (
	completionPrefix = "X_LITELLM_"
	embeddingsPrefix = "X_LITELLM_EMBEDDINGS_"
)

// Options builds the channel.
type Options struct {
	Dispatcher *dispatcher.Dispatcher
	Logger     *zap.Logger
}

type llm struct {
	dispatcher *dispatcher.Dispatcher
	logger     *zap.Logger
}

// New returns the gateway-backed LLMChannel.
func New(opts Options) channels.LLMChannel {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	return &llm{dispatcher: opts.Dispatcher, logger: logger}
}

// Complete runs one chat completion with the tenant's X_LITELLM_* params.
func (l *llm) Complete(ctx context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
	call, err := buildCompletion(req)
	if err != nil {
		return channels.CompletionResponse{}, err
	}
	resp, err := l.dispatch(ctx, call)
	if err != nil {
		return channels.CompletionResponse{}, err
	}
	out, err := parseCompletion(resp.Body)
	if err != nil {
		return channels.CompletionResponse{}, err
	}
	out.CostUSD = costUSD(resp.Usage)
	out.RequestBody = call.Body
	out.ResponseBody = resp.Body
	return out, nil
}

// Embed embeds the inputs with the tenant's X_LITELLM_EMBEDDINGS_* params.
func (l *llm) Embed(ctx context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
	call, err := buildEmbedding(req)
	if err != nil {
		return channels.EmbeddingResponse{}, err
	}
	resp, err := l.dispatch(ctx, call)
	if err != nil {
		return channels.EmbeddingResponse{}, err
	}
	out, err := parseEmbedding(resp.Body, len(req.Inputs))
	if err != nil {
		return channels.EmbeddingResponse{}, err
	}
	out.CostUSD = costUSD(resp.Usage)
	return out, nil
}

func (l *llm) dispatch(ctx context.Context, call dispatcher.Request) (*domain.Response, error) {
	resp, err := l.dispatcher.Dispatch(ctx, call)
	if err != nil {
		l.logger.Debug("evaluator_llm_dispatch_failed",
			zap.String("provider", string(call.Credential.ProviderID)),
			zap.String("model", call.Model),
		)
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("model provider answered status %d", resp.StatusCode)
	}
	return resp, nil
}

// buildCompletion mirrors llmexecutor.buildGatewayRequest for the evaluator's
// narrower request; env params override the evaluator's own, as in Python.
func buildCompletion(req channels.CompletionRequest) (dispatcher.Request, error) {
	params := envParams(req.Tenant.Env, completionPrefix)
	target, err := resolveTarget(modelOf(params, req.Model), params)
	if err != nil {
		return dispatcher.Request{}, err
	}
	body := map[string]any{"model": target.bare, "messages": req.Messages}
	if len(req.Tools) > 0 {
		body["tools"] = req.Tools
	}
	if len(req.ToolChoice) > 0 {
		body["tool_choice"] = req.ToolChoice
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		body["max_tokens"] = *req.MaxTokens
	}
	if req.N > 1 {
		body["n"] = req.N
	}
	if req.ReasoningEffort != "" {
		body["reasoning_effort"] = req.ReasoningEffort
	}
	applyGenerationParams(body, params)
	litellmparams.NormalizeReasoningEffort(body)
	litellmparams.EnsureReasoningMaxTokens(body)
	litellmparams.ApplyReasoningOverrides(target.translated, body)
	litellmparams.ClampAnthropicTemperature(target.provider, body)
	dropClaudeTopP(target.translated, body)
	return target.request(domain.RequestTypeChat, body)
}

// buildEmbedding follows patch_litellm_embedding_params: the provider's
// named env keys first, X_LITELLM_EMBEDDINGS_* over them.
func buildEmbedding(req channels.EmbeddingRequest) (dispatcher.Request, error) {
	model := req.Model
	if deployment := req.Tenant.Env["AZURE_EMBEDDINGS_DEPLOYMENT_NAME"]; deployment != "" {
		model = "azure/" + deployment
	}
	params := providerEnvParams(req.Tenant.Env, providerOf(model))
	for key, value := range envParams(req.Tenant.Env, embeddingsPrefix) {
		params[key] = value
	}
	target, err := resolveTarget(modelOf(params, model), params)
	if err != nil {
		return dispatcher.Request{}, err
	}
	return target.request(domain.RequestTypeEmbeddings, map[string]any{"model": target.bare, "input": req.Inputs})
}

type target struct {
	provider   string
	translated string
	bare       string
	credential domain.Credential
}

func resolveTarget(model string, params map[string]any) (target, error) {
	provider := providerOf(model)
	_, name := litellmparams.SplitProviderModel(model)
	translated := litellmparams.TranslateModelID(provider + "/" + name)
	_, bare := litellmparams.SplitProviderModel(translated)
	inline, err := litellmparams.FromLiteLLMParams(provider, params)
	if err != nil {
		return target{}, fmt.Errorf("%w: %w", channels.ErrProviderNotConfigured, err)
	}
	credential, err := inline.Credential()
	if err != nil {
		return target{}, fmt.Errorf("%w: %w", channels.ErrProviderNotConfigured, err)
	}
	if credential.APIKey == "" && len(credential.Extra) == 0 {
		return target{}, fmt.Errorf("%w: %s", channels.ErrProviderNotConfigured, provider)
	}
	credential = domain.WithDeploymentSelfMap(credential, bare)
	return target{provider: provider, translated: translated, bare: bare, credential: credential}, nil
}

func (t target) request(kind domain.RequestType, body map[string]any) (dispatcher.Request, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return dispatcher.Request{}, fmt.Errorf("marshal model request: %w", err)
	}
	return dispatcher.Request{Type: kind, Model: t.bare, Body: raw, Credential: t.credential}, nil
}

// providerOf reads the model's provider prefix; litellm treats a bare model as openai.
func providerOf(model string) string {
	if provider, _ := litellmparams.SplitProviderModel(model); provider != "" {
		return provider
	}
	return "openai"
}

// modelOf honors an X_LITELLM_model param over the requested model, as Python did.
func modelOf(params map[string]any, requested string) string {
	if model, ok := params["model"].(string); ok && model != "" {
		return model
	}
	return requested
}

// envParams collects prefix-named params, skipping the embeddings block for the
// chat prefix and all-uppercase names (Python: "not a litellm key").
func envParams(env map[string]string, prefix string) map[string]any {
	params := map[string]any{}
	for key, value := range env {
		name, ok := strings.CutPrefix(key, prefix)
		if !ok || name == "" || name == strings.ToUpper(name) {
			continue
		}
		if prefix == completionPrefix && strings.HasPrefix(key, embeddingsPrefix) {
			continue
		}
		params[name] = value
	}
	return params
}

// providerEnvParams is litellm_patch.py's PROVIDER_CREDENTIAL_VARS, read from
// the request env only; the first present name wins.
func providerEnvParams(env map[string]string, provider string) map[string]any {
	params := map[string]any{}
	for argument, names := range providerEnvNames(provider) {
		for _, name := range names {
			if value := env[name]; value != "" {
				params[argument] = value
				break
			}
		}
	}
	return params
}

func providerEnvNames(provider string) map[string][]string {
	switch provider {
	case "openai":
		return map[string][]string{"api_key": {"OPENAI_API_KEY"}, "api_base": {"OPENAI_BASE_URL"}}
	case "azure":
		return map[string][]string{
			"api_key":     {"AZURE_API_KEY", "AZURE_OPENAI_API_KEY"},
			"api_base":    {"AZURE_API_BASE", "AZURE_OPENAI_ENDPOINT"},
			"api_version": {"AZURE_API_VERSION"},
		}
	case "anthropic":
		return map[string][]string{"api_key": {"ANTHROPIC_API_KEY"}}
	case "groq":
		return map[string][]string{"api_key": {"GROQ_API_KEY"}}
	case "gemini":
		return map[string][]string{"api_key": {"GEMINI_API_KEY"}}
	case "vertex_ai":
		return map[string][]string{"vertex_credentials": {"GOOGLE_APPLICATION_CREDENTIALS"}}
	case "bedrock":
		return map[string][]string{
			"aws_access_key_id":     {"AWS_ACCESS_KEY_ID"},
			"aws_secret_access_key": {"AWS_SECRET_ACCESS_KEY"},
			"aws_session_token":     {"AWS_SESSION_TOKEN"},
			"aws_region_name":       {"AWS_REGION_NAME"},
		}
	}
	return nil
}

// applyGenerationParams lays TS's whitelisted generation settings over the
// body, typed as convert_param_type does; an unparsable number is dropped.
func applyGenerationParams(body map[string]any, params map[string]any) {
	for _, name := range []string{"temperature", "top_p", "frequency_penalty", "presence_penalty"} {
		if value, ok := parsedParam(params, name, func(raw string) (any, error) { return strconv.ParseFloat(raw, 64) }); ok {
			body[name] = value
		}
	}
	for _, name := range []string{"max_tokens", "seed"} {
		if value, ok := parsedParam(params, name, func(raw string) (any, error) { return strconv.Atoi(raw) }); ok {
			body[name] = value
		}
	}
	if effort, ok := params["reasoning_effort"].(string); ok && effort != "" {
		body["reasoning_effort"] = effort
	}
}

// parsedParam reads params[name] when it is a string parse accepts.
func parsedParam(params map[string]any, name string, parse func(string) (any, error)) (any, bool) {
	raw, ok := params[name].(string)
	if !ok {
		return nil, false
	}
	value, err := parse(raw)
	return value, err == nil
}

// dropClaudeTopP mirrors apply_anthropic_sampling_compatibility: Claude refuses
// temperature and top_p together, so top_p goes.
func dropClaudeTopP(model string, body map[string]any) {
	_, hasTemperature := body["temperature"]
	if hasTemperature && strings.Contains(strings.ToLower(model), "claude") {
		delete(body, "top_p")
	}
}

// costUSD reports the gateway's price when it set one; nil means unpriced.
func costUSD(usage domain.Usage) *float64 {
	if usage.CostMicroUSD <= 0 {
		return nil
	}
	cost := float64(usage.CostMicroUSD) / 1_000_000
	return &cost
}

type openAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content   *string `json:"content"`
			ToolCalls []struct {
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage openAIUsage `json:"usage"`
}

func parseCompletion(body []byte) (channels.CompletionResponse, error) {
	var parsed chatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return channels.CompletionResponse{}, fmt.Errorf("decode chat completion: %w", err)
	}
	out := channels.CompletionResponse{Usage: channels.Usage(parsed.Usage)}
	for _, choice := range parsed.Choices {
		mapped := channels.Choice{FinishReason: choice.FinishReason}
		if choice.Message.Content != nil {
			mapped.Content = *choice.Message.Content
		}
		for _, call := range choice.Message.ToolCalls {
			mapped.ToolCalls = append(mapped.ToolCalls, channels.ToolCall{Name: call.Function.Name, Arguments: call.Function.Arguments})
		}
		out.Choices = append(out.Choices, mapped)
	}
	return out, nil
}

type embeddingResponse struct {
	Data []struct {
		Index     int       `json:"index"`
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
	Usage openAIUsage `json:"usage"`
}

func parseEmbedding(body []byte, inputs int) (channels.EmbeddingResponse, error) {
	var parsed embeddingResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return channels.EmbeddingResponse{}, fmt.Errorf("decode embeddings: %w", err)
	}
	vectors := make([][]float64, inputs)
	for _, item := range parsed.Data {
		if item.Index < 0 || item.Index >= inputs {
			return channels.EmbeddingResponse{}, fmt.Errorf("embedding index %d out of range", item.Index)
		}
		vectors[item.Index] = item.Embedding
	}
	return channels.EmbeddingResponse{Vectors: vectors, Usage: channels.Usage(parsed.Usage)}, nil
}
