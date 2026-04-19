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

func TestParse_ForceDeferred(t *testing.T) {
	m, err := Parse("force")
	if !errors.Is(err, ErrNotImplemented) {
		t.Fatalf("force should be ErrNotImplemented, got err=%v", err)
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

func TestApply_ForceIsErrNotImplemented(t *testing.T) {
	_, err := Apply(Mode{Kind: KindForce}, []byte(`{}`))
	if !errors.Is(err, ErrNotImplemented) {
		t.Errorf("force should return ErrNotImplemented; got %v", err)
	}
}
