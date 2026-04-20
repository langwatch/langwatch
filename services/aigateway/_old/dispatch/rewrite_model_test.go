package dispatch

import (
	"encoding/json"
	"testing"
)

func TestRewriteRequestModel(t *testing.T) {
	in := []byte(`{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`)
	out := rewriteRequestModel(in, "openai/gpt-5-mini", "gpt-5-mini")

	var parsed struct {
		Model    string          `json:"model"`
		Messages json.RawMessage `json:"messages"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed.Model != "gpt-5-mini" {
		t.Errorf("want model=gpt-5-mini, got %q", parsed.Model)
	}
	if len(parsed.Messages) == 0 {
		t.Errorf("messages should be preserved")
	}
}

func TestRewriteRequestModel_NoOp(t *testing.T) {
	in := []byte(`{"model":"gpt-5-mini"}`)
	out := rewriteRequestModel(in, "gpt-5-mini", "gpt-5-mini")
	if string(out) != string(in) {
		t.Errorf("no-op should return body unchanged; got %q", out)
	}
}

func TestRewriteRequestModel_Alias(t *testing.T) {
	in := []byte(`{"model":"my-alias","temperature":0.2}`)
	out := rewriteRequestModel(in, "my-alias", "claude-haiku-4-5")

	var parsed struct {
		Model       string  `json:"model"`
		Temperature float64 `json:"temperature"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed.Model != "claude-haiku-4-5" {
		t.Errorf("want model=claude-haiku-4-5, got %q", parsed.Model)
	}
	if parsed.Temperature != 0.2 {
		t.Errorf("want temperature preserved, got %v", parsed.Temperature)
	}
}

func TestRewriteRequestModel_InvalidJSON(t *testing.T) {
	in := []byte(`not json`)
	out := rewriteRequestModel(in, "x", "y")
	if string(out) != string(in) {
		t.Errorf("invalid JSON should return body unchanged; got %q", out)
	}
}
