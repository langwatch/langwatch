package cacheoverride

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestParse_EmptyIsRespect(t *testing.T) {
	m, err := Parse("")
	if err != nil || m.Kind != KindRespect {
		t.Errorf("empty → respect, got %+v err=%v", m, err)
	}
}

func TestParse_CaseInsensitive(t *testing.T) {
	for _, raw := range []string{"DISABLE", "Disable", "  disable  "} {
		m, err := Parse(raw)
		if err != nil || m.Kind != KindDisable {
			t.Errorf("%q should parse to disable, got %+v err=%v", raw, m, err)
		}
	}
}

func TestParse_ForceImplemented(t *testing.T) {
	// Iter 50: force is now implemented for Anthropic-shape bodies
	// (inject cache_control: ephemeral on system[-1] + messages[-1]
	// .content[-1]). Non-Anthropic shapes are a passthrough no-op.
	m, err := Parse("force")
	if err != nil {
		t.Fatalf("force should parse cleanly; got err=%v", err)
	}
	if m.Kind != KindForce {
		t.Errorf("kind: %s", m.Kind)
	}
}

func TestParse_TTLDeferred(t *testing.T) {
	m, err := Parse("ttl=3600")
	if !errors.Is(err, ErrNotImplemented) {
		t.Fatalf("ttl=N should be ErrNotImplemented, got err=%v", err)
	}
	if m.Kind != KindTTL || m.TTLSecs != 3600 {
		t.Errorf("ttl parse: %+v", m)
	}
}

func TestParse_InvalidValues(t *testing.T) {
	for _, raw := range []string{"off", "ttl=", "ttl=abc", "ttl=-1", "randomtext"} {
		if _, err := Parse(raw); !errors.Is(err, ErrInvalid) {
			t.Errorf("%q should be invalid, got err=%v", raw, err)
		}
	}
}

func TestApply_RespectIsNoOp(t *testing.T) {
	body := []byte(`{"messages":[{"role":"user","content":[{"type":"text","text":"hi","cache_control":{"type":"ephemeral"}}]}]}`)
	out, err := Apply(Mode{Kind: KindRespect}, body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, body) {
		t.Errorf("respect must return byte-identical body")
	}
}

func TestApply_DisableStripsCacheControl(t *testing.T) {
	body := []byte(`{
		"messages":[
			{"role":"user","content":[
				{"type":"text","text":"A","cache_control":{"type":"ephemeral"}},
				{"type":"text","text":"B"}
			]}
		],
		"system":[{"type":"text","text":"sys","cache_control":{"type":"ephemeral"}}]
	}`)
	out, err := Apply(Mode{Kind: KindDisable}, body)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "cache_control") {
		t.Errorf("cache_control should be stripped; got: %s", out)
	}
	// Sanity: content still valid JSON and preserves text fields.
	var decoded map[string]any
	if err := json.Unmarshal(out, &decoded); err != nil {
		t.Fatalf("stripped body not valid JSON: %v", err)
	}
	if !strings.Contains(string(out), `"text":"A"`) || !strings.Contains(string(out), `"text":"B"`) {
		t.Errorf("payload content dropped unexpectedly: %s", out)
	}
}

func TestApply_DisableNonJSONError(t *testing.T) {
	_, err := Apply(Mode{Kind: KindDisable}, []byte("not json"))
	if err == nil {
		t.Fatal("expected error on non-JSON body")
	}
}

func TestApply_EmptyBody_IsNoOp(t *testing.T) {
	out, err := Apply(Mode{Kind: KindDisable}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 0 {
		t.Errorf("empty input should return empty output")
	}
}

func TestApply_TTLIsErrNotImplemented(t *testing.T) {
	// ttl=N still deferred — Anthropic doesn't accept explicit TTL,
	// so an edge-cache at the gateway would be needed.
	_, err := Apply(Mode{Kind: KindTTL, TTLSecs: 600}, []byte(`{}`))
	if !errors.Is(err, ErrNotImplemented) {
		t.Errorf("ttl should return ErrNotImplemented; got %v", err)
	}
}

func TestApply_ForceInjectsAnthropicSystem(t *testing.T) {
	body := []byte(`{"system":[{"type":"text","text":"hi"}],"messages":[{"role":"user","content":"ping"}]}`)
	out, err := Apply(Mode{Kind: KindForce}, body)
	if err != nil {
		t.Fatalf("force should succeed; got %v", err)
	}
	if !strings.Contains(string(out), `"cache_control":{"type":"ephemeral"}`) {
		t.Errorf("expected cache_control ephemeral injected; got %s", out)
	}
}

func TestApply_ForceInjectsLastUserContent(t *testing.T) {
	// No system, structured content on last user message.
	body := []byte(`{"messages":[{"role":"user","content":[{"type":"text","text":"first"},{"type":"text","text":"last"}]}]}`)
	out, err := Apply(Mode{Kind: KindForce}, body)
	if err != nil {
		t.Fatalf("force should succeed; got %v", err)
	}
	if !strings.Contains(string(out), `"cache_control":{"type":"ephemeral"}`) {
		t.Errorf("expected cache_control injected on last content; got %s", out)
	}
	// First content block should NOT carry cache_control
	if strings.Count(string(out), `"cache_control"`) > 1 {
		t.Errorf("only last content block should get cache_control; got %s", out)
	}
}

func TestApply_ForceDoesNotDoubleInject(t *testing.T) {
	// Client already set cache_control on the target block — gateway
	// must preserve it (no double-stamping, no duplicate markers).
	body := []byte(`{"system":[{"type":"text","text":"hi","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":"ping"}]}`)
	out, err := Apply(Mode{Kind: KindForce}, body)
	if err != nil {
		t.Fatalf("force should succeed; got %v", err)
	}
	// Exactly one cache_control marker — the client's
	if strings.Count(string(out), `"cache_control"`) != 1 {
		t.Errorf("client-set cache_control must not be double-injected; got %s", out)
	}
}

func TestApply_ForceOnOpenAIShapeIsNoop(t *testing.T) {
	// OpenAI shape: content is a string, no system block as array,
	// no cache_control injection possible without breaking the
	// schema. Injector returns body unchanged.
	body := []byte(`{"model":"gpt-5-mini","messages":[{"role":"user","content":"ping"}]}`)
	out, err := Apply(Mode{Kind: KindForce}, body)
	if err != nil {
		t.Fatalf("force should succeed; got %v", err)
	}
	if string(out) != string(body) {
		t.Errorf("OpenAI-shape force should be passthrough; got %s", out)
	}
}

func TestApply_ForceEmptyBodyNoop(t *testing.T) {
	out, err := Apply(Mode{Kind: KindForce}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 0 {
		t.Errorf("empty body should pass through; got %s", out)
	}
}
