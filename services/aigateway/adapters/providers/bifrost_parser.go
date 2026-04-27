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
func isOpenAICompatibleProvider(p bfschemas.ModelProvider) bool {
	switch p {
	case bfschemas.OpenAI, bfschemas.Azure:
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
// Only call on raw-forward paths for OpenAI / Azure. Anthropic / Gemini /
// Vertex / Bedrock emit usage natively in their stream deltas and this flag
// is meaningless on their wire formats.
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
