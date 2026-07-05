package providers

import (
	"context"
	"encoding/json"
	"fmt"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/bytedance/sonic"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// buildEmbeddingRequest parses an OpenAI-shape embedding body into a
// BifrostEmbeddingRequest. The wire shape is:
//
//	{"model": "<provider-prefixed or bare>", "input": <string | []string | int[] | int[][]>, ...}
//
// Bifrost's EmbeddingInput is a strict one-of over those four shapes,
// so we route the input by JSON type. Extra OpenAI params
// (`encoding_format`, `dimensions`) map onto EmbeddingParameters; any
// other keys (e.g. provider-specific `input_type` for Voyage/Cohere)
// pass through via ExtraParams so Bifrost forwards them downstream.
func buildEmbeddingRequest(
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
) (*bfschemas.BifrostEmbeddingRequest, error) {
	if len(req.Body) == 0 {
		return nil, fmt.Errorf("empty embedding request body")
	}

	inputResult := gjson.GetBytes(req.Body, "input")
	if !inputResult.Exists() {
		return nil, fmt.Errorf("embedding request missing 'input' field")
	}

	bfInput := &bfschemas.EmbeddingInput{}
	switch inputResult.Type {
	case gjson.String:
		s := inputResult.String()
		bfInput.Text = &s
	case gjson.JSON:
		// Array — either []string or [][]int or []int.
		if inputResult.IsArray() {
			arr := inputResult.Array()
			if len(arr) == 0 {
				return nil, fmt.Errorf("embedding input array is empty")
			}
			switch arr[0].Type {
			case gjson.String:
				texts := make([]string, len(arr))
				for i, v := range arr {
					texts[i] = v.String()
				}
				bfInput.Texts = texts
			case gjson.Number:
				ints := make([]int, len(arr))
				for i, v := range arr {
					ints[i] = int(v.Int())
				}
				bfInput.Embedding = ints
			case gjson.JSON:
				if arr[0].IsArray() {
					nested := make([][]int, len(arr))
					for i, v := range arr {
						inner := v.Array()
						ints := make([]int, len(inner))
						for j, x := range inner {
							ints[j] = int(x.Int())
						}
						nested[i] = ints
					}
					bfInput.Embeddings = nested
				} else {
					return nil, fmt.Errorf("unsupported embedding input shape: array of objects")
				}
			default:
				return nil, fmt.Errorf("unsupported embedding input element type: %s", arr[0].Type)
			}
		} else {
			return nil, fmt.Errorf("unsupported embedding input shape: object (expected string or array)")
		}
	default:
		return nil, fmt.Errorf("unsupported embedding input type: %s", inputResult.Type)
	}

	bfReq := &bfschemas.BifrostEmbeddingRequest{
		Provider: provider,
		Model:    model,
		Input:    bfInput,
	}

	// Carry OpenAI params + provider-specific extras. Bifrost passes
	// ExtraParams through to the downstream provider verbatim.
	params := &bfschemas.EmbeddingParameters{ExtraParams: map[string]interface{}{}}
	hasParams := false
	if v := gjson.GetBytes(req.Body, "encoding_format"); v.Exists() {
		s := v.String()
		params.EncodingFormat = &s
		hasParams = true
	}
	if v := gjson.GetBytes(req.Body, "dimensions"); v.Exists() {
		d := int(v.Int())
		params.Dimensions = &d
		hasParams = true
	}
	// Forward any remaining keys outside the OpenAI core set so
	// Voyage's `input_type` / Cohere's `truncate` etc. survive the
	// gateway.
	gjson.ParseBytes(req.Body).ForEach(func(key, value gjson.Result) bool {
		switch key.String() {
		case "model", "input", "encoding_format", "dimensions":
			return true
		}
		params.ExtraParams[key.String()] = value.Value()
		hasParams = true
		return true
	})
	if hasParams {
		bfReq.Params = params
	}
	return bfReq, nil
}

// buildChatRequest constructs a BifrostChatRequest appropriate for the
// inbound request type. RequestTypeChat expects an OpenAI-shape body and
// goes through the parser (Bifrost then translates per-provider).
// RequestTypeMessages expects an Anthropic-shape body and is forwarded
// raw (Bifrost's own adapter decodes it natively).
//
// Returned context is enriched with the raw-forward flag when required;
// callers should use it to derive the BifrostContext.
func buildChatRequest(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
) (*bfschemas.BifrostChatRequest, context.Context, error) {
	if req.Type == domain.RequestTypeMessages {
		return &bfschemas.BifrostChatRequest{
				Provider:       provider,
				Model:          model,
				RawRequestBody: req.Body,
				Input:          []bfschemas.ChatMessage{},
			},
			rawForwardCtx(ctx),
			nil
	}

	// OpenAI-family providers accept the OpenAI wire format natively, so
	// there is nothing to translate. Running the body through
	// parse+re-marshal still subtly changes bytes (JSON key ordering,
	// whitespace, number formatting) which breaks OpenAI's prefix-hash
	// auto-cache between two otherwise-identical calls. Raw-forward
	// preserves byte-for-byte identity and keeps cache hits working.
	// Translation earns its keep only when the target wire format
	// differs from the inbound (Anthropic / Gemini / Bedrock / Vertex).
	if isOpenAICompatibleProvider(provider) {
		return &bfschemas.BifrostChatRequest{
				Provider:       provider,
				Model:          model,
				RawRequestBody: req.Body,
				Input:          []bfschemas.ChatMessage{},
			},
			rawForwardCtx(ctx),
			nil
	}

	messages, params, err := parseOpenAIChatRequest(req.Body)
	if err != nil {
		return nil, ctx, err
	}
	return &bfschemas.BifrostChatRequest{
		Provider: provider,
		Model:    model,
		Input:    messages,
		Params:   params,
	}, ctx, nil
}

// isOpenAICompatibleProvider reports whether the destination provider
// natively speaks OpenAI chat-completions wire format. When true, the
// gateway raw-forwards the inbound body rather than parse+re-marshal,
// preserving byte-for-byte identity so OpenAI prompt-prefix auto-cache
// continues to hit between repeated calls.
//
// VLLM is included: it is Bifrost's generic OpenAI-compatible adapter,
// the destination for customer-hosted endpoints (self-hosted vLLM,
// LiteLLM proxies) mapped from provider "custom" and from "openai" with
// a base-URL override. Raw-forwarding them preserves the provider-specific
// sampling params the structured parse would otherwise drop (top_k,
// repetition_penalty, chat_template_kwargs, guided_json, ...) and lets
// DispatchStream inject stream_options.include_usage so streamed token
// usage still reaches billing/traces.
func isOpenAICompatibleProvider(p bfschemas.ModelProvider) bool {
	switch p {
	case bfschemas.OpenAI, bfschemas.Azure, bfschemas.VLLM:
		return true
	default:
		return false
	}
}

// parseOpenAIChatRequest decodes an OpenAI-shape /v1/chat/completions body
// into Bifrost's normalized request structures. Bifrost's own ChatMessage +
// ChatParameters types carry OpenAI-compatible JSON tags, so each provider
// family translates from this neutral shape downstream (OpenAI → pass-through,
// Anthropic → Messages API, Gemini → generateContent, etc.).
//
// The input []ChatMessage is read off the `messages` key; everything else
// (temperature, tools, response_format, stream_options, seed, logprobs,
// max_completion_tokens, ...) unmarshals onto ChatParameters via its json
// tags. `stream` is not part of ChatParameters — the caller decides the
// streaming dispatch path, so we simply discard it here.
//
// Provider-specific extension fields (e.g. Gemini's `cached_content` for
// referencing a pre-created CachedContent resource) live in
// ChatParameters.ExtraParams. The Bifrost gemini translator at
// providers/gemini/chat.go:50-54 reads the "cached_content" key off
// ExtraParams and lifts it onto geminiReq.CachedContent — but ExtraParams
// is `json:"-"`, so a stock json.Unmarshal can't populate it. We lift
// supported extension keys explicitly here so callers can drive
// gemini/vertex prompt caching via the standard chat-completions
// endpoint without needing a native gemini route.
func parseOpenAIChatRequest(body []byte) ([]bfschemas.ChatMessage, *bfschemas.ChatParameters, error) {
	if len(body) == 0 {
		return nil, nil, nil
	}

	var messagesWrap struct {
		Messages []bfschemas.ChatMessage `json:"messages"`
	}
	if err := sonic.Unmarshal(body, &messagesWrap); err != nil {
		return nil, nil, fmt.Errorf("parse messages: %w", err)
	}

	var params bfschemas.ChatParameters
	if err := sonic.Unmarshal(body, &params); err != nil {
		return nil, nil, fmt.Errorf("parse params: %w", err)
	}

	liftExtensionParams(body, &params)

	return messagesWrap.Messages, &params, nil
}

// chatExtensionKeys enumerates the provider-extension fields the gateway
// recognizes on the inbound /v1/chat/completions body and forwards via
// ChatParameters.ExtraParams. Bifrost's per-provider translators read these
// off ExtraParams and lift them onto the provider-native request shape.
//
// Currently:
//   - cached_content: Gemini/Vertex CachedContent reference
//     (see providers/gemini/chat.go:50-54). Required to read prompt cache
//     hits on accounts where implicit caching isn't enabled.
//   - safety_settings: Gemini SafetySettings array
//     (providers/gemini/chat.go:43-48).
//   - labels: Gemini per-request labels (providers/gemini/chat.go:57-62).
//
// Add new keys here only when a Bifrost translator reads them from
// ExtraParams — silently lifting an unrecognized field leaks vendor
// jargon into providers that won't recognize it.
var chatExtensionKeys = []string{
	"cached_content",
	"safety_settings",
	"labels",
}

// ensureStreamIncludeUsage injects stream_options.include_usage=true on an
// OpenAI-shape /v1/chat/completions body when the caller asked for streaming
// but didn't opt in to the final usage SSE chunk. Without include_usage,
// OpenAI streams finish with zero prompt/completion tokens — cost-enrichment
// then has nothing to fold and the trace shows tokens=0 + success_no_usage.
//
// The function is a no-op when:
//   - the body has no "stream":true (non-stream dispatch),
//   - the body already carries stream_options.include_usage (caller decided).
//
// Only call on raw-forward paths for OpenAI / Azure / VLLM (self-hosted
// OpenAI-compatible). Anthropic / Gemini / Vertex / Bedrock emit usage
// natively in their stream deltas and this flag is meaningless on their
// wire formats.
func ensureStreamIncludeUsage(body []byte) []byte {
	if len(body) == 0 {
		return body
	}
	if !gjson.GetBytes(body, "stream").Bool() {
		return body
	}
	if gjson.GetBytes(body, "stream_options.include_usage").Exists() {
		return body
	}
	out, err := sjson.SetBytes(body, "stream_options.include_usage", true)
	if err != nil {
		return body
	}
	return out
}

func liftExtensionParams(body []byte, params *bfschemas.ChatParameters) {
	var raw map[string]json.RawMessage
	if err := sonic.Unmarshal(body, &raw); err != nil {
		return
	}
	for _, key := range chatExtensionKeys {
		v, ok := raw[key]
		if !ok {
			continue
		}
		var decoded interface{}
		if err := sonic.Unmarshal(v, &decoded); err != nil {
			continue
		}
		if params.ExtraParams == nil {
			params.ExtraParams = make(map[string]interface{})
		}
		params.ExtraParams[key] = decoded
	}
}
