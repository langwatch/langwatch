package dispatch

import (
	"encoding/json"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

func cfg(aliases map[string]string, allowed []string, creds ...auth.ProviderCred) *auth.Config {
	return &auth.Config{
		VirtualKeyID:  "vk_1",
		ProviderCreds: creds,
		ModelAliases:  aliases,
		ModelsAllowed: allowed,
	}
}
func pcOpenAI() auth.ProviderCred { return auth.ProviderCred{ID: "pc_oa", Type: "openai", Credentials: json.RawMessage(`{"api_key":"k"}`)} }
func pcAnthropic() auth.ProviderCred { return auth.ProviderCred{ID: "pc_an", Type: "anthropic", Credentials: json.RawMessage(`{"api_key":"k"}`)} }

func TestResolveModelAliasWinsOverExplicitSlash(t *testing.T) {
	b := &auth.Bundle{Config: cfg(
		map[string]string{"chat": "openai/gpt-5-mini"},
		[]string{"gpt-5-mini"},
		pcOpenAI(), pcAnthropic(),
	)}
	rm, err := resolveModel(b, "chat")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if rm.Provider != bfschemas.OpenAI || rm.Model != "gpt-5-mini" || rm.Source != "alias" {
		t.Errorf("%+v", rm)
	}
}

func TestResolveModelExplicitSlash(t *testing.T) {
	b := &auth.Bundle{Config: cfg(nil, nil, pcOpenAI(), pcAnthropic())}
	rm, err := resolveModel(b, "anthropic/claude-haiku-4-5")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if rm.Provider != bfschemas.Anthropic || rm.Model != "claude-haiku-4-5" || rm.Source != "explicit_slash" {
		t.Errorf("%+v", rm)
	}
}

func TestResolveModelImplicitSingleProvider(t *testing.T) {
	b := &auth.Bundle{Config: cfg(nil, nil, pcOpenAI())}
	rm, err := resolveModel(b, "gpt-5-mini")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if rm.Provider != bfschemas.OpenAI || rm.Model != "gpt-5-mini" {
		t.Errorf("%+v", rm)
	}
}

func TestResolveModelAmbiguousErrors(t *testing.T) {
	b := &auth.Bundle{Config: cfg(nil, nil, pcOpenAI(), pcAnthropic())}
	_, err := resolveModel(b, "gpt-5-mini") // no alias, no slash, multiple providers
	if err == nil {
		t.Fatal("expected ambiguity error")
	}
}

func TestResolveModelNotAllowedByAllowlist(t *testing.T) {
	b := &auth.Bundle{Config: cfg(
		map[string]string{"chat": "openai/gpt-4o"},
		[]string{"gpt-5-mini"}, // 4o not in allowlist
		pcOpenAI(),
	)}
	_, err := resolveModel(b, "chat")
	if !isModelNotAllowed(err) {
		t.Fatalf("expected errModelNotAllowed, got %v", err)
	}
}

func TestResolveModelGlobAllowlist(t *testing.T) {
	b := &auth.Bundle{Config: cfg(
		map[string]string{"chat": "anthropic/claude-haiku-4-5-20251001"},
		[]string{"claude-haiku-*"},
		pcAnthropic(),
	)}
	if _, err := resolveModel(b, "chat"); err != nil {
		t.Errorf("glob allow missed match: %v", err)
	}
}

func TestParseOpenAIChatBody(t *testing.T) {
	body := []byte(`{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}],"stream":true}`)
	req, err := parseOpenAIChatBody(body)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if req.Model != "gpt-5-mini" || !req.Stream {
		t.Errorf("parsed: %+v", req)
	}
}

func TestParseOpenAIChatBodyMissingModel(t *testing.T) {
	if _, err := parseOpenAIChatBody([]byte(`{"messages":[]}`)); err == nil {
		t.Error("expected error on missing model")
	}
}
