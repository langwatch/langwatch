package litellm

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestSplitProviderModel(t *testing.T) {
	cases := []struct {
		in       string
		provider string
		model    string
	}{
		{"openai/gpt-5-mini", "openai", "gpt-5-mini"},
		{"anthropic/claude-3.5-sonnet", "anthropic", "claude-3.5-sonnet"},
		{"vertex_ai/gemini-2.0-flash", "vertex_ai", "gemini-2.0-flash"},
		{"bedrock/anthropic.claude-3-sonnet-20240229-v1:0", "bedrock", "anthropic.claude-3-sonnet-20240229-v1:0"},
		{"gpt-3.5-turbo", "", "gpt-3.5-turbo"},
		{"AZURE/My-Deployment", "azure", "My-Deployment"},
	}
	for _, c := range cases {
		p, m := SplitProviderModel(c.in)
		if p != c.provider || m != c.model {
			t.Errorf("SplitProviderModel(%q) = (%q, %q); want (%q, %q)", c.in, p, m, c.provider, c.model)
		}
	}
}

func TestTranslateModelID_AnthropicDotToDash(t *testing.T) {
	got := TranslateModelID("anthropic/claude-opus-4.5")
	if got != "anthropic/claude-opus-4-5" {
		t.Errorf("expected dot→dash for anthropic, got %q", got)
	}
}

func TestTranslateModelID_AliasExpansion(t *testing.T) {
	cases := map[string]string{
		"anthropic/claude-sonnet-4":   "anthropic/claude-sonnet-4-20250514",
		"anthropic/claude-opus-4":     "anthropic/claude-opus-4-20250514",
		"anthropic/claude-3.5-haiku":  "anthropic/claude-3-5-haiku-20241022",
		"anthropic/claude-3.5-sonnet": "anthropic/claude-3-5-sonnet-20240620",
	}
	for in, want := range cases {
		if got := TranslateModelID(in); got != want {
			t.Errorf("TranslateModelID(%q) = %q; want %q", in, got, want)
		}
	}
}

func TestTranslateModelID_OpenAIPreserveDots(t *testing.T) {
	// gpt-3.5-turbo must keep its dot — only anthropic/custom translate.
	got := TranslateModelID("openai/gpt-3.5-turbo")
	if got != "openai/gpt-3.5-turbo" {
		t.Errorf("expected openai dots preserved, got %q", got)
	}
}

func TestTranslateModelID_BareIDsTreatedAsAnthropic(t *testing.T) {
	// Bare ids (no provider prefix) get the dot→dash treatment too —
	// the TS source does this for safety.
	got := TranslateModelID("claude-3.5-sonnet")
	if got != "claude-3-5-sonnet" {
		t.Errorf("expected bare anthropic-shaped id translated, got %q", got)
	}
}

func TestTranslateModelID_CustomDotToDash(t *testing.T) {
	got := TranslateModelID("custom/my-llm-1.2")
	if got != "custom/my-llm-1-2" {
		t.Errorf("expected custom dot→dash, got %q", got)
	}
}

func TestGatewayProviderForModel_CustomFlipsToOpenAI(t *testing.T) {
	if got := GatewayProviderForModel("custom"); got != "openai" {
		t.Errorf("expected custom→openai, got %q", got)
	}
	if got := GatewayProviderForModel("anthropic"); got != "anthropic" {
		t.Errorf("expected anthropic unchanged, got %q", got)
	}
}

func TestIsReasoningModel(t *testing.T) {
	yes := []string{
		"openai/o1-mini", "openai/o3", "openai/o4-preview",
		"openai/gpt-5-mini", "gpt-5", "o1",
	}
	// Pin Python parity: matching is anchored on the model BASENAME
	// (anything after the last `/`, or the full string if no `/`),
	// not the full provider/model string. A naive `\b(o1|o3|...)`
	// substring scan against the full id would false-match these,
	// causing temperature pinning + max_tokens flooring to fire on
	// non-reasoning models.
	no := []string{
		"openai/gpt-4o", "anthropic/claude-3-5-sonnet", "gemini/gemini-2.0-flash",
		"openai/gpt-3.5-turbo",
		// CodeRabbit-flagged false-positives that the basename-anchor fixes:
		"openai/co3-thing",     // `co3` would substring-match o3 in the full id
		"vertex_ai/pro1-model", // `pro1` would substring-match o1 in the full id
		"custom/super-gpt-5x",  // gpt-5 anywhere but the start would substring-match
	}
	for _, m := range yes {
		if !IsReasoningModel(m) {
			t.Errorf("IsReasoningModel(%q) = false; want true", m)
		}
	}
	for _, m := range no {
		if IsReasoningModel(m) {
			t.Errorf("IsReasoningModel(%q) = true; want false (basename-anchor pin)", m)
		}
	}
}

func TestApplyReasoningOverrides_PinsTemperatureAndFloorsMaxTokens(t *testing.T) {
	body := map[string]any{
		"temperature": 0.2,
		"max_tokens":  1000,
	}
	mutated := ApplyReasoningOverrides("openai/gpt-5-mini", body)
	if !mutated {
		t.Fatalf("expected mutation for reasoning model")
	}
	if body["temperature"] != float64(1.0) {
		t.Errorf("expected temperature pinned to 1.0, got %v", body["temperature"])
	}
	if _, present := body["max_tokens"]; present {
		t.Errorf("max_tokens must be removed for reasoning models, got %v", body["max_tokens"])
	}
	if body["max_completion_tokens"] != reasoningMaxTokensFloor {
		t.Errorf("expected max_completion_tokens floored to %d, got %v",
			reasoningMaxTokensFloor, body["max_completion_tokens"])
	}
}

func TestApplyReasoningOverrides_HighMaxTokensPreserved(t *testing.T) {
	body := map[string]any{"max_tokens": 32000}
	ApplyReasoningOverrides("openai/o3", body)
	if _, present := body["max_tokens"]; present {
		t.Errorf("max_tokens must be removed for reasoning models, got %v", body["max_tokens"])
	}
	if body["max_completion_tokens"] != 32000 {
		t.Errorf("expected high max_completion_tokens preserved, got %v",
			body["max_completion_tokens"])
	}
}

func TestApplyReasoningOverrides_NonReasoningUntouched(t *testing.T) {
	body := map[string]any{"temperature": 0.2, "max_tokens": 100}
	if ApplyReasoningOverrides("openai/gpt-4o", body) {
		t.Errorf("expected no mutation for non-reasoning model")
	}
	if body["temperature"] != 0.2 {
		t.Errorf("temperature must not change for gpt-4o")
	}
	if body["max_tokens"] != 100 {
		t.Errorf("max_tokens must not change for gpt-4o")
	}
}

func TestClampAnthropicTemperature(t *testing.T) {
	body := map[string]any{"temperature": 1.5}
	ClampAnthropicTemperature("anthropic", body)
	if body["temperature"] != float64(1) {
		t.Errorf("expected clamp to 1, got %v", body["temperature"])
	}
}

func TestClampAnthropicTemperature_NegativeClampsToZero(t *testing.T) {
	body := map[string]any{"temperature": -0.5}
	ClampAnthropicTemperature("anthropic", body)
	if body["temperature"] != float64(0) {
		t.Errorf("expected clamp to 0, got %v", body["temperature"])
	}
}

func TestClampAnthropicTemperature_OtherProvidersUntouched(t *testing.T) {
	body := map[string]any{"temperature": 1.5}
	ClampAnthropicTemperature("openai", body)
	if body["temperature"] != 1.5 {
		t.Errorf("openai temperature must not be clamped, got %v", body["temperature"])
	}
}

func TestNormalizeReasoningEffort_PicksFirstSpelling(t *testing.T) {
	body := map[string]any{
		"reasoning":     "low",
		"thinkingLevel": "medium",
	}
	NormalizeReasoningEffort(body)
	if body["reasoning_effort"] != "low" && body["reasoning_effort"] != "medium" {
		t.Errorf("expected one of {low,medium}, got %v", body["reasoning_effort"])
	}
	if _, present := body["reasoning"]; present {
		t.Errorf("expected reasoning key dropped after normalization")
	}
	if _, present := body["thinkingLevel"]; present {
		t.Errorf("expected thinkingLevel key dropped after normalization")
	}
}

func TestNormalizeReasoningEffort_PrefersCanonicalKey(t *testing.T) {
	body := map[string]any{
		"reasoning":        "low",
		"reasoning_effort": "high",
	}
	NormalizeReasoningEffort(body)
	if body["reasoning_effort"] != "high" {
		t.Errorf("expected canonical key wins, got %v", body["reasoning_effort"])
	}
}

func TestNormalizeReasoningEffort_NoKeyNoOp(t *testing.T) {
	body := map[string]any{"temperature": 0.5}
	NormalizeReasoningEffort(body)
	if _, present := body["reasoning_effort"]; present {
		t.Errorf("expected no key inserted when none of the candidates exist")
	}
}

// TestEnsureReasoningMaxTokens_FloorsAnthropicWithReasoningEnabled pins
// langwatch_nlp regression ead6141a4 ("auto-increase max_tokens when
// reasoning/effort enabled"). When a non-OpenAI model has a reasoning
// field set, the upstream provider may auto-enable extended thinking
// with budget_tokens that exceeds the customer's configured max_tokens,
// causing the API to 400. Pre-fix the Go path mirrored this bug because
// ApplyReasoningOverrides is gated on IsReasoningModel (OpenAI-only).
//
// The fix: EnsureReasoningMaxTokens runs after NormalizeReasoningEffort
// and floors max_tokens for ANY model when reasoning_effort is present
// in the request body. Provider-specific renames (max_tokens →
// max_completion_tokens for OpenAI reasoning) still happen later in
// ApplyReasoningOverrides; this helper only ensures the floor is met.
func TestEnsureReasoningMaxTokens_FloorsAnthropicWithReasoningEnabled(t *testing.T) {
	body := map[string]any{
		"reasoning_effort": "high",
		"max_tokens":       4096,
	}
	mutated := EnsureReasoningMaxTokens(body)
	if !mutated {
		t.Fatalf("expected floor to apply when reasoning_effort is set with low max_tokens")
	}
	if got := body["max_tokens"]; got != reasoningMaxTokensFloor {
		t.Errorf("expected max_tokens=%d, got %v", reasoningMaxTokensFloor, got)
	}
}

// TestEnsureReasoningMaxTokens_PreservesHighMaxTokens guards against
// regressions that lower an already-high customer-set max_tokens. Floor
// only raises; never lowers.
func TestEnsureReasoningMaxTokens_PreservesHighMaxTokens(t *testing.T) {
	body := map[string]any{
		"reasoning_effort": "medium",
		"max_tokens":       64000,
	}
	EnsureReasoningMaxTokens(body)
	if body["max_tokens"] != 64000 {
		t.Errorf("expected high max_tokens preserved, got %v", body["max_tokens"])
	}
}

// TestEnsureReasoningMaxTokens_InsertsWhenAbsent covers the implicit
// default — a customer who configured reasoning_effort but no max_tokens
// still needs the floor applied or the provider 400s.
func TestEnsureReasoningMaxTokens_InsertsWhenAbsent(t *testing.T) {
	body := map[string]any{"reasoning_effort": "low"}
	mutated := EnsureReasoningMaxTokens(body)
	if !mutated {
		t.Fatalf("expected insertion when reasoning_effort is set without max_tokens")
	}
	if got := body["max_tokens"]; got != reasoningMaxTokensFloor {
		t.Errorf("expected max_tokens=%d, got %v", reasoningMaxTokensFloor, got)
	}
}

// TestEnsureReasoningMaxTokens_NoReasoningNoOp guards the false-positive
// direction: a non-reasoning request must keep its customer-configured
// max_tokens unchanged.
func TestEnsureReasoningMaxTokens_NoReasoningNoOp(t *testing.T) {
	body := map[string]any{"max_tokens": 256}
	if EnsureReasoningMaxTokens(body) {
		t.Errorf("expected no mutation when reasoning_effort is absent")
	}
	if body["max_tokens"] != 256 {
		t.Errorf("max_tokens must not change when no reasoning is enabled, got %v", body["max_tokens"])
	}
}

// TestEnsureReasoningMaxTokens_EmptyReasoningEffortNoOp covers the
// edge case where reasoning_effort is present but explicitly empty —
// treated as "not enabled" so no floor is applied. Mirrors the Python
// `bool(...)` truthiness check in has_reasoning_enabled.
func TestEnsureReasoningMaxTokens_EmptyReasoningEffortNoOp(t *testing.T) {
	body := map[string]any{
		"reasoning_effort": "",
		"max_tokens":       100,
	}
	if EnsureReasoningMaxTokens(body) {
		t.Errorf("expected no mutation when reasoning_effort is the empty string")
	}
	if body["max_tokens"] != 100 {
		t.Errorf("max_tokens must not change when reasoning_effort is empty, got %v", body["max_tokens"])
	}
}

func TestFromLiteLLMParams_OpenAI(t *testing.T) {
	ic, err := FromLiteLLMParams("openai", map[string]any{
		"api_key":      "sk-test",
		"api_base":     "https://api.openai.com/v1",
		"organization": "org-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ic.Provider != "openai" {
		t.Errorf("expected provider openai, got %q", ic.Provider)
	}
	if ic.OpenAI["api_key"] != "sk-test" {
		t.Errorf("expected api_key sk-test, got %q", ic.OpenAI["api_key"])
	}
	if ic.OpenAI["api_base"] != "https://api.openai.com/v1" {
		t.Errorf("expected api_base, got %q", ic.OpenAI["api_base"])
	}
	if ic.OpenAI["organization"] != "org-1" {
		t.Errorf("expected organization org-1, got %q", ic.OpenAI["organization"])
	}
}

func TestFromLiteLLMParams_Anthropic(t *testing.T) {
	ic, err := FromLiteLLMParams("anthropic", map[string]any{"api_key": "k"})
	if err != nil {
		t.Fatal(err)
	}
	if ic.Anthropic["api_key"] != "k" {
		t.Errorf("expected anthropic api_key, got %v", ic.Anthropic)
	}
}

func TestFromLiteLLMParams_Azure_PreservesNestedExtraHeaders(t *testing.T) {
	ic, err := FromLiteLLMParams("azure", map[string]any{
		"api_key":       "azk",
		"api_base":      "https://acme.openai.azure.com",
		"api_version":   "2024-05-01-preview",
		"extra_headers": map[string]any{"X-Tag": "acme"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if ic.Azure["api_key"] != "azk" {
		t.Errorf("expected azure api_key")
	}
	eh, ok := ic.Azure["extra_headers"].(map[string]any)
	if !ok {
		t.Fatalf("extra_headers must remain a nested map for the gateway to re-marshal, got %T", ic.Azure["extra_headers"])
	}
	if eh["X-Tag"] != "acme" {
		t.Errorf("expected X-Tag in extra_headers")
	}
}

func TestFromLiteLLMParams_Bedrock(t *testing.T) {
	ic, err := FromLiteLLMParams("bedrock", map[string]any{
		"aws_access_key_id":     "AKIA",
		"aws_secret_access_key": "secret",
		"aws_session_token":     "tok",
		"aws_region_name":       "us-east-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ic.Bedrock["aws_access_key_id"] != "AKIA" || ic.Bedrock["aws_session_token"] != "tok" {
		t.Errorf("bedrock fields not preserved: %+v", ic.Bedrock)
	}
}

func TestFromLiteLLMParams_VertexAI(t *testing.T) {
	ic, err := FromLiteLLMParams("vertex_ai", map[string]any{
		"vertex_credentials": `{"type":"service_account"}`,
		"vertex_project":     "acme-vertex",
		"vertex_location":    "us-central1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ic.VertexAI["vertex_credentials"] != `{"type":"service_account"}` {
		t.Errorf("vertex_credentials must be preserved verbatim as inline JSON string")
	}
}

func TestFromLiteLLMParams_VertexAlias(t *testing.T) {
	// "vertex" should map to vertex_ai too — dispatcher normalization.
	ic, err := FromLiteLLMParams("vertex", map[string]any{"vertex_project": "p"})
	if err != nil {
		t.Fatal(err)
	}
	if ic.Provider != "vertex_ai" {
		t.Errorf("expected normalized provider vertex_ai, got %q", ic.Provider)
	}
}

func TestFromLiteLLMParams_Custom(t *testing.T) {
	ic, err := FromLiteLLMParams("custom", map[string]any{
		"api_key":  "k",
		"api_base": "https://api.together.xyz/v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ic.Provider != "custom" {
		t.Errorf("custom keeps provider=custom in inline-creds; gateway-side does the openai mapping")
	}
}

func TestFromLiteLLMParams_RejectsUnknown(t *testing.T) {
	_, err := FromLiteLLMParams("weird", map[string]any{"api_key": "k"})
	if err == nil {
		t.Errorf("expected error for unknown provider")
	}
}

func TestFromLiteLLMParams_RejectsEmpty(t *testing.T) {
	_, err := FromLiteLLMParams("", map[string]any{})
	if err == nil {
		t.Errorf("expected error for empty provider")
	}
}

func TestInlineCredentials_EncodeDecodeRoundtrip(t *testing.T) {
	ic := InlineCredentials{
		Provider: "openai",
		OpenAI:   map[string]string{"api_key": "sk-test"},
	}
	encoded, err := ic.Encode()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("expected base64 std encoding, got %q: %v", encoded, err)
	}
	var got InlineCredentials
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Provider != "openai" || got.OpenAI["api_key"] != "sk-test" {
		t.Errorf("roundtrip lost data: %+v", got)
	}
}

func TestInlineCredentials_OmitOtherSlots(t *testing.T) {
	// Only the active provider's slot should appear in the JSON; keep
	// the bytes small and avoid leaking empty slots into logs.
	ic := InlineCredentials{
		Provider: "openai",
		OpenAI:   map[string]string{"api_key": "sk-test"},
	}
	b, _ := json.Marshal(ic)
	s := string(b)
	for _, k := range []string{"anthropic", "azure", "bedrock", "vertex_ai", "gemini", "custom"} {
		if strings.Contains(s, `"`+k+`"`) {
			t.Errorf("expected slot %q omitted, got %s", k, s)
		}
	}
}

func TestInlineCredentials_RequiresProvider(t *testing.T) {
	ic := InlineCredentials{Provider: ""}
	if _, err := ic.Encode(); err == nil {
		t.Errorf("expected error when provider is empty")
	}
}
