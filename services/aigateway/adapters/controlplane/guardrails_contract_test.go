package controlplane

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The control plane and the data plane have to agree on the guardrail wire
// shape. They did not: this struct read "action" while the control plane sent
// "decision", so every verdict fell through to allow and no guardrail ever
// blocked anything. These tests pin both halves of the contract.

func TestGuardrailResponseUsesTheContractVerdictField(t *testing.T) {
	body := []byte(`{"decision":"block","reason":"PII detected: email","policies_triggered":["pii"]}`)

	var result guardrailCheckResponse
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result.Decision != "block" {
		t.Fatalf("decision = %q, want block", result.Decision)
	}
	if result.Reason != "PII detected: email" {
		t.Fatalf("reason = %q", result.Reason)
	}
	if len(result.PoliciesTriggered) != 1 || result.PoliciesTriggered[0] != "pii" {
		t.Fatalf("policies_triggered = %v", result.PoliciesTriggered)
	}
}

// A response carrying the old field name must not read as a valid verdict. If
// this ever passes, the two sides have drifted apart again.
func TestGuardrailResponseIgnoresTheOldActionField(t *testing.T) {
	var result guardrailCheckResponse
	if err := json.Unmarshal([]byte(`{"action":"block","message":"nope"}`), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result.Decision != "" {
		t.Fatalf("decision = %q, want empty so the caller treats it as a mismatch", result.Decision)
	}
}

func TestGuardrailRequestUsesTheContractFieldNames(t *testing.T) {
	body, err := json.Marshal(guardrailCheckRequest{
		VirtualKeyID: "vk_1",
		ProjectID:    "proj_1",
		Direction:    "request",
		Content:      contentFor("request", []byte(`{"messages":[{"role":"user","content":"hi"}]}`)),
		GuardrailIDs: []string{"guard_1"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var wire map[string]any
	if err := json.Unmarshal(body, &wire); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, field := range []string{"vk_id", "project_id", "direction", "content", "guardrail_ids"} {
		if _, ok := wire[field]; !ok {
			t.Fatalf("request is missing contract field %q: %s", field, body)
		}
	}
	content, ok := wire["content"].(map[string]any)
	if !ok {
		t.Fatalf("content is not an object: %s", body)
	}
	if _, ok := content["messages"]; !ok {
		t.Fatalf("request-direction content must carry messages: %s", body)
	}
}

func TestContentForPacksEachDirectionUnderItsOwnKey(t *testing.T) {
	t.Run("request extracts the messages array", func(t *testing.T) {
		got := contentFor("request", []byte(`{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`))
		if !strings.Contains(string(got.Messages), `"role":"user"`) {
			t.Fatalf("messages = %s", got.Messages)
		}
		if got.Output != "" || got.Chunk != "" {
			t.Fatalf("request direction must not set output or chunk: %+v", got)
		}
	})

	t.Run("response extracts the assistant text", func(t *testing.T) {
		got := contentFor("response", []byte(`{"choices":[{"message":{"content":"the answer"}}]}`))
		if got.Output != "the answer" {
			t.Fatalf("output = %q", got.Output)
		}
	})

	t.Run("response falls back to the raw body when the shape is unknown", func(t *testing.T) {
		got := contentFor("response", []byte(`{"unexpected":true}`))
		if got.Output != `{"unexpected":true}` {
			t.Fatalf("output = %q", got.Output)
		}
	})

	t.Run("stream chunk carries the chunk", func(t *testing.T) {
		got := contentFor("stream_chunk", []byte("partial text"))
		if got.Chunk != "partial text" {
			t.Fatalf("chunk = %q", got.Chunk)
		}
	})
}

// The control plane's Zod schema is the other half of the contract. Reading it
// here keeps a rename on the TypeScript side from silently breaking the gateway.
func TestControlPlaneSchemaAgreesOnTheWireShape(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "langwatch", "src", "server", "routes", "gateway-internal.ts")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("control plane source not available: %v", err)
	}
	text := string(source)

	start := strings.Index(text, "const guardrailCheckRequestSchema")
	if start < 0 {
		t.Fatal("guardrailCheckRequestSchema not found in the control plane route")
	}
	end := strings.Index(text[start:], "});")
	if end < 0 {
		t.Fatal("could not delimit guardrailCheckRequestSchema")
	}
	schema := text[start : start+end]

	for _, field := range []string{"vk_id", "project_id", "direction", "guardrail_ids", "content"} {
		if !strings.Contains(schema, field) {
			t.Errorf("control plane request schema is missing %q", field)
		}
	}
	if strings.Contains(schema, `"pre"`) || strings.Contains(schema, `"post"`) {
		t.Error("control plane request schema still accepts the storage enum values instead of the wire directions")
	}

	// The accepted directions live in one exported constant so both the route
	// and this test read the same source of truth. The schema used to inline
	// the storage enum instead, so every live gateway call failed validation.
	servicePath := filepath.Join("..", "..", "..", "..", "langwatch", "src", "server", "gateway", "guardrailEvaluation.service.ts")
	serviceSource, err := os.ReadFile(servicePath)
	if err != nil {
		t.Skipf("control plane guardrail service not available: %v", err)
	}
	for _, direction := range []string{"request", "response", "stream_chunk"} {
		if !strings.Contains(string(serviceSource), `"`+direction+`"`) {
			t.Errorf("control plane does not accept direction %q", direction)
		}
	}
}
