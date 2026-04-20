package dispatch

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

// ResolvedModel is the output of resolveModel — tells the dispatcher which
// provider to speak to and under what model name.
type ResolvedModel struct {
	Provider bfschemas.ModelProvider
	Model    string // the provider-native model name (after alias resolution)
	Source   string // "alias" | "explicit_slash" | "implicit" — for observability
}

var errNoMatchingProvider = errors.New("no provider credential for this model")

// resolveModel applies the VK config's model_aliases + models_allowed rules
// to the incoming `model` field:
//
//  1. If `model` is in model_aliases, use the alias target (wins always).
//  2. Else if `model` is "<provider>/<model>" form, split eagerly — no
//     fallback retry. If the provider prefix doesn't match any of the
//     VK's bound providers, return an enriched error listing the
//     available providers and model form options.
//  3. Else pick the only provider slot (single-provider VK). Multi-
//     provider VKs without alias/prefix are ambiguous by design —
//     return the same enriched error so the user knows to disambiguate
//     with either `provider/model` or a VK-level alias.
//
// Then it checks models_allowed if the list is non-empty. Returns
// errModelNotAllowed when the effective model is outside the allowlist.
//
// Hot-path constraint: single pass over the request string, no branch
// retries, no exception-driven fallback. Everything is pre-baked on the
// VK config when the bundle materialises.
func resolveModel(b *auth.Bundle, requested string) (ResolvedModel, error) {
	if b == nil || b.Config == nil {
		return ResolvedModel{}, errors.New("no VK config loaded")
	}
	cfg := b.Config

	target := requested
	source := "implicit"
	if alias, ok := cfg.ModelAliases[requested]; ok {
		target = alias
		source = "alias"
	} else if strings.Contains(requested, "/") {
		source = "explicit_slash"
	}

	var providerKey bfschemas.ModelProvider
	var modelName string
	if strings.Contains(target, "/") {
		parts := strings.SplitN(target, "/", 2)
		providerKey = aliasProvider(parts[0])
		modelName = parts[1]
		if !providerBoundOnVK(cfg, providerKey) {
			return ResolvedModel{}, errProviderNotBound{
				providerGiven: parts[0],
				bound:         boundProviderTypes(cfg),
				modelName:     modelName,
			}
		}
	} else {
		// No provider prefix — for single-provider VKs pick that provider;
		// for multi-provider VKs default to the primary (first) credential.
		// Runtime stays permissive per rchaves: ambiguity is rejected at
		// config/save time (control plane), not on the hot path.
		if len(cfg.ProviderCreds) == 0 {
			return ResolvedModel{}, errNoMatchingProvider
		}
		providerKey = aliasProvider(cfg.ProviderCreds[0].Type)
		modelName = target
	}

	if !modelAllowed(cfg, modelName) {
		return ResolvedModel{}, errModelNotAllowed{model: modelName}
	}
	return ResolvedModel{Provider: providerKey, Model: modelName, Source: source}, nil
}

// providerBoundOnVK returns true when the VK config has a provider credential
// whose slot type matches the given Bifrost provider key.
func providerBoundOnVK(cfg *auth.Config, providerKey bfschemas.ModelProvider) bool {
	for _, pc := range cfg.ProviderCreds {
		if aliasProvider(pc.Type) == providerKey {
			return true
		}
	}
	return false
}

// boundProviderTypes returns the sorted, de-duplicated list of provider
// slot types bound on the VK. Used only to enrich error messages.
func boundProviderTypes(cfg *auth.Config) []string {
	seen := make(map[string]struct{}, len(cfg.ProviderCreds))
	out := make([]string, 0, len(cfg.ProviderCreds))
	for _, pc := range cfg.ProviderCreds {
		if _, ok := seen[pc.Type]; ok {
			continue
		}
		seen[pc.Type] = struct{}{}
		out = append(out, pc.Type)
	}
	return out
}

// errProviderNotBound — user sent `<prefix>/<model>` but the prefix isn't
// one of the providers this VK is bound to. The error string names the
// providers the VK actually has, so the fix is obvious.
type errProviderNotBound struct {
	providerGiven string
	bound         []string
	modelName     string
}

func (e errProviderNotBound) Error() string {
	if len(e.bound) == 0 {
		return fmt.Sprintf("provider %q is not bound on this virtual key (no providers bound yet)", e.providerGiven)
	}
	return fmt.Sprintf(
		"provider %q is not bound on this virtual key (bound: %s) — try %q, define an alias on the VK, or re-prefix with one of the bound providers",
		e.providerGiven, strings.Join(e.bound, ", "), e.modelName,
	)
}


type errModelNotAllowed struct{ model string }

func (e errModelNotAllowed) Error() string {
	return fmt.Sprintf("model %q is not in VK models_allowed", e.model)
}

func isModelNotAllowed(err error) bool {
	_, ok := err.(errModelNotAllowed)
	return ok
}

func modelAllowed(cfg *auth.Config, model string) bool {
	if len(cfg.ModelsAllowed) == 0 {
		return true
	}
	for _, pat := range cfg.ModelsAllowed {
		if matchGlob(pat, model) {
			return true
		}
	}
	return false
}

// matchGlob is a forgiving glob matcher: supports trailing * and exact.
// Good enough for model allowlists like "gpt-5-mini", "claude-haiku-*".
// Full regex support comes later via blocked_patterns regex fields.
func matchGlob(pattern, s string) bool {
	if pattern == s {
		return true
	}
	if strings.HasSuffix(pattern, "*") {
		prefix := strings.TrimSuffix(pattern, "*")
		return strings.HasPrefix(s, prefix)
	}
	return false
}

// openaiChatRequest is the subset of the OpenAI chat-completions payload
// we need for routing + span enrichment. The raw body still passes
// through to Bifrost via RawRequestBody; everything here is extra
// copy-out for OTel semconv attributes on the gateway span.
type openaiChatRequest struct {
	Model           string          `json:"model"`
	Stream          bool            `json:"stream,omitempty"`
	Messages        json.RawMessage `json:"messages"`
	System          json.RawMessage `json:"system,omitempty"` // Anthropic-style /v1/messages carries system separately
	Temperature     *float64        `json:"temperature,omitempty"`
	MaxTokens       *int64          `json:"max_tokens,omitempty"`
	MaxCompletion   *int64          `json:"max_completion_tokens,omitempty"`
	TopP            *float64        `json:"top_p,omitempty"`
	FrequencyPenalty *float64       `json:"frequency_penalty,omitempty"`
	PresencePenalty *float64        `json:"presence_penalty,omitempty"`
	Stop            json.RawMessage `json:"stop,omitempty"`           // string | string[]
	StopSequences   json.RawMessage `json:"stop_sequences,omitempty"` // anthropic
}

// parseOpenAIChatBody peeks at the JSON to pull out {model, stream}. The
// raw body is kept byte-for-byte for passthrough to bifrost (preserves
// cache_control and any provider-specific fields the client added).
func parseOpenAIChatBody(body []byte) (openaiChatRequest, error) {
	var req openaiChatRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return req, fmt.Errorf("decode openai chat body: %w", err)
	}
	if req.Model == "" {
		return req, errors.New("request is missing 'model' field")
	}
	return req, nil
}

// rewriteRequestModel rewrites the top-level "model" field of an OpenAI-
// compatible JSON body to the provider-native model name the dispatcher
// resolved. This covers the "openai/gpt-5-mini" → "gpt-5-mini" case
// where the user used litellm-style prefix notation: resolveModel strips
// the prefix for routing, but Bifrost forwards RawRequestBody verbatim,
// so the upstream would otherwise receive the prefix and 400.
//
// No-ops when current == target. Returns body unchanged on decode errors
// (callers already validated with parseOpenAIChatBody upstream).
func rewriteRequestModel(body []byte, current, target string) []byte {
	if current == target || target == "" {
		return body
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil {
		return body
	}
	patched, err := json.Marshal(target)
	if err != nil {
		return body
	}
	obj["model"] = patched
	out, err := json.Marshal(obj)
	if err != nil {
		return body
	}
	return out
}

// ensureStreamOptionsIncludeUsage injects `stream_options: {include_usage: true}`
// into an OpenAI-shape streaming request body when the caller didn't already
// set it. OpenAI (and Azure OpenAI) only emit `usage` on the final chunk of
// a stream when this option is present — without it the gateway would debit
// zero tokens on every streaming call. Anthropic, Gemini, Vertex, and
// Bedrock emit usage in their native stream deltas, so this is a no-op
// there (and `stream_options` isn't part of their wire format anyway).
//
// Preserves any caller-supplied `include_usage: false` — if a client opted
// out explicitly we respect that. Returns body unchanged on any decode error.
func ensureStreamOptionsIncludeUsage(body []byte, provider bfschemas.ModelProvider) []byte {
	if provider != bfschemas.OpenAI && provider != bfschemas.Azure {
		return body
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil {
		return body
	}
	if existing, ok := obj["stream_options"]; ok {
		var opts map[string]json.RawMessage
		if err := json.Unmarshal(existing, &opts); err != nil {
			return body
		}
		if _, set := opts["include_usage"]; set {
			return body
		}
		trueBytes, err := json.Marshal(true)
		if err != nil {
			return body
		}
		opts["include_usage"] = trueBytes
		patched, err := json.Marshal(opts)
		if err != nil {
			return body
		}
		obj["stream_options"] = patched
	} else {
		patched, err := json.Marshal(map[string]bool{"include_usage": true})
		if err != nil {
			return body
		}
		obj["stream_options"] = patched
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return body
	}
	return out
}
