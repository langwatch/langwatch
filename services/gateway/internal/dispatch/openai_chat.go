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
//  2. Else if `model` is "<provider>/<model>" form, split.
//  3. Else — try to pick the only provider slot (rare single-provider case).
//     If multiple provider slots exist and no alias/prefix, error out.
//
// Then it checks models_allowed if the list is non-empty. Returns
// errModelNotAllowed when the effective model is outside the allowlist.
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
	} else {
		// No provider prefix — pick the single provider on the VK.
		if len(cfg.ProviderCreds) == 1 {
			providerKey = aliasProvider(cfg.ProviderCreds[0].Type)
			modelName = target
		} else if len(cfg.ProviderCreds) == 0 {
			return ResolvedModel{}, errNoMatchingProvider
		} else {
			return ResolvedModel{}, fmt.Errorf("model %q is ambiguous: VK has %d provider slots and no alias matched", requested, len(cfg.ProviderCreds))
		}
	}

	if !modelAllowed(cfg, modelName) {
		return ResolvedModel{}, errModelNotAllowed{model: modelName}
	}
	return ResolvedModel{Provider: providerKey, Model: modelName, Source: source}, nil
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
// we need for routing. We don't parse all extra params — they pass
// through via RawRequestBody.
type openaiChatRequest struct {
	Model    string          `json:"model"`
	Stream   bool            `json:"stream,omitempty"`
	Messages json.RawMessage `json:"messages"`
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
