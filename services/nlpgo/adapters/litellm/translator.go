package litellm

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

// InlineCredentials is the JSON payload nlpgo sends in the
// X-LangWatch-Inline-Credentials header. The gateway-side middleware in
// services/aigateway/adapters/httpapi/internal_auth.go accepts this exact
// shape — keep them in sync. Only the slot for the active provider should
// be populated; the rest should be omitted.
type InlineCredentials struct {
	Provider  string                 `json:"provider"`
	OpenAI    map[string]string      `json:"openai,omitempty"`
	Anthropic map[string]string      `json:"anthropic,omitempty"`
	Azure     map[string]any         `json:"azure,omitempty"`
	Bedrock   map[string]string      `json:"bedrock,omitempty"`
	VertexAI  map[string]string      `json:"vertex_ai,omitempty"`
	Gemini    map[string]string      `json:"gemini,omitempty"`
	Custom    map[string]string      `json:"custom,omitempty"`
}

// Encode returns the base64-JSON header value for the inline-credentials
// blob. Empty provider is rejected — sending an unset blob to the gateway
// would 401 anyway.
func (ic InlineCredentials) Encode() (string, error) {
	if ic.Provider == "" {
		return "", errors.New("inline credentials: provider is required")
	}
	b, err := json.Marshal(ic)
	if err != nil {
		return "", fmt.Errorf("marshal inline credentials: %w", err)
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// FromLiteLLMParams maps a `litellm_params` dict into the inline-credentials
// shape, dispatching by `provider` (parsed from the model id by the caller).
//
// Unknown fields in `params` are ignored — the source-of-truth fields are
// dictated by langwatch/src/server/api/routers/modelProviders.utils.ts:225
// (prepareLitellmParams). Adding a new field there means adding it here.
func FromLiteLLMParams(provider string, params map[string]any) (InlineCredentials, error) {
	switch provider {
	case "openai":
		return InlineCredentials{
			Provider: "openai",
			OpenAI:   pickStrings(params, "api_key", "api_base", "organization"),
		}, nil
	case "anthropic":
		return InlineCredentials{
			Provider:  "anthropic",
			Anthropic: pickStrings(params, "api_key", "api_base"),
		}, nil
	case "azure":
		return InlineCredentials{
			Provider: "azure",
			Azure: pickAny(params,
				"api_key", "api_base", "api_version",
				"use_azure_gateway", "extra_headers",
			),
		}, nil
	case "bedrock":
		return InlineCredentials{
			Provider: "bedrock",
			Bedrock: pickStrings(params,
				"aws_access_key_id", "aws_secret_access_key",
				"aws_session_token", "aws_region_name",
				"aws_bedrock_runtime_endpoint",
			),
		}, nil
	case "vertex_ai", "vertex":
		return InlineCredentials{
			Provider: "vertex_ai",
			VertexAI: pickStrings(params,
				"vertex_credentials", "vertex_project", "vertex_location",
			),
		}, nil
	case "gemini":
		return InlineCredentials{
			Provider: "gemini",
			Gemini:   pickStrings(params, "api_key"),
		}, nil
	case "custom":
		// Custom routes to OpenAI-compat at the gateway, but at the inline-
		// credentials boundary we keep "custom" so the gateway middleware
		// can apply its own custom-→-openai mapping with the correct field
		// names. See the gateway-side parseInlineCredentials.
		return InlineCredentials{
			Provider: "custom",
			Custom:   pickStrings(params, "api_key", "api_base"),
		}, nil
	case "":
		return InlineCredentials{}, errors.New("provider is required")
	default:
		return InlineCredentials{}, fmt.Errorf("unsupported provider: %q", provider)
	}
}

// ApplyReasoningOverrides mutates the provider request body in place to
// pin temperature to 1.0 and floor max_tokens at reasoningMaxTokensFloor
// for reasoning-class models. Returns true if any override was applied
// (so the caller can log it for diagnostics).
//
// modelID is the ALREADY-translated id (post TranslateModelID) so the
// regex matches consistently across `openai/o3` and bare `o3`.
func ApplyReasoningOverrides(modelID string, body map[string]any) bool {
	if !IsReasoningModel(modelID) {
		return false
	}
	body["temperature"] = float64(1.0)
	// OpenAI's reasoning-class models (o1/o3/o4/o5/gpt-5) reject
	// max_tokens with HTTP 400 ("Unsupported parameter: 'max_tokens'
	// is not supported with this model. Use 'max_completion_tokens'
	// instead."). Migrate the field if the caller set it, and apply
	// the floor either way.
	existing := body["max_tokens"]
	delete(body, "max_tokens")
	floor := reasoningMaxTokensFloor
	switch n := existing.(type) {
	case int:
		if n > floor {
			floor = n
		}
	case int64:
		if int(n) > floor {
			floor = int(n)
		}
	case float64:
		if int(n) > floor {
			floor = int(n)
		}
	}
	body["max_completion_tokens"] = floor
	return true
}

// ClampAnthropicTemperature pins temperature to [0, 1] for anthropic
// models. The Anthropic API rejects > 1 with a 400, so we clamp instead
// of forwarding and 400-ing — preserves customer-workflow behavior that
// passed inflated temperatures via DSPy without issue.
func ClampAnthropicTemperature(provider string, body map[string]any) {
	if provider != "anthropic" {
		return
	}
	v, ok := body["temperature"]
	if !ok {
		return
	}
	switch n := v.(type) {
	case float64:
		if n < 0 {
			body["temperature"] = float64(0)
		} else if n > 1 {
			body["temperature"] = float64(1)
		}
	case int:
		if n < 0 {
			body["temperature"] = float64(0)
		} else if n > 1 {
			body["temperature"] = float64(1)
		}
	}
}

// NormalizeReasoningEffort collapses any of `reasoning`, `reasoning_effort`,
// `thinkingLevel`, `effort` into a single canonical key `reasoning_effort`.
// LiteLLM-era code paths have all four spellings in the wild — pick the
// first one we find, drop the rest. Only string values are honored; nested
// dicts (a future shape) pass through untouched on `reasoning`.
func NormalizeReasoningEffort(body map[string]any) {
	candidates := []string{"reasoning_effort", "reasoning", "thinkingLevel", "effort"}
	var picked any
	for _, k := range candidates {
		v, ok := body[k]
		if !ok {
			continue
		}
		if s, isString := v.(string); isString && s != "" {
			picked = s
			break
		}
		if picked == nil {
			picked = v
		}
	}
	if picked == nil {
		return
	}
	for _, k := range candidates {
		delete(body, k)
	}
	body["reasoning_effort"] = picked
}

// pickStrings copies the named keys from `in` into a new map[string]string,
// converting numeric/bool values via fmt.Sprint when they show up. Returns
// nil for an empty result so the JSON marshaling drops the slot via
// `omitempty`.
func pickStrings(in map[string]any, keys ...string) map[string]string {
	out := make(map[string]string, len(keys))
	for _, k := range keys {
		v, ok := in[k]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if t != "" {
				out[k] = t
			}
		default:
			out[k] = fmt.Sprint(t)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// pickAny copies the named keys from `in` into a new map preserving non-
// string values (so e.g. Azure's `extra_headers` JSON object survives as
// a nested map; the gateway middleware re-marshals it back to JSON before
// dispatch). Returns nil on empty.
func pickAny(in map[string]any, keys ...string) map[string]any {
	out := make(map[string]any, len(keys))
	for _, k := range keys {
		v, ok := in[k]
		if !ok || v == nil {
			continue
		}
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
