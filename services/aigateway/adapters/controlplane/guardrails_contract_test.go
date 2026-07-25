package controlplane

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
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
	packed, err := contentFor("request", []byte(`{"messages":[{"role":"user","content":"hi"}]}`))
	if err != nil {
		t.Fatalf("contentFor: %v", err)
	}
	body, err := json.Marshal(guardrailCheckRequest{
		VirtualKeyID: "vk_1",
		ProjectID:    "proj_1",
		Direction:    "request",
		Content:      packed,
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
	mustPack := func(t *testing.T, direction string, payload []byte) guardrailCheckContent {
		t.Helper()
		got, err := contentFor(direction, payload)
		if err != nil {
			t.Fatalf("contentFor(%q): %v", direction, err)
		}
		return got
	}

	t.Run("request extracts the messages array", func(t *testing.T) {
		got := mustPack(t, "request", []byte(`{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`))
		if !strings.Contains(string(got.Messages), `"role":"user"`) {
			t.Fatalf("messages = %s", got.Messages)
		}
		if got.Output != "" || got.Chunk != "" {
			t.Fatalf("request direction must not set output or chunk: %+v", got)
		}
	})

	t.Run("response extracts the assistant text", func(t *testing.T) {
		got := mustPack(t, "response", []byte(`{"choices":[{"message":{"content":"the answer"}}]}`))
		if got.Output != "the answer" {
			t.Fatalf("output = %q", got.Output)
		}
	})

	t.Run("response falls back to the raw body when the shape is unknown", func(t *testing.T) {
		got := mustPack(t, "response", []byte(`{"unexpected":true}`))
		if got.Output != `{"unexpected":true}` {
			t.Fatalf("output = %q", got.Output)
		}
	})

	t.Run("stream chunk carries the chunk", func(t *testing.T) {
		got := mustPack(t, "stream_chunk", []byte("partial text"))
		if got.Chunk != "partial text" {
			t.Fatalf("chunk = %q", got.Chunk)
		}
	})

	// The storage vocabulary and typos must not be packed as chunks. Before
	// this, a catch-all default sent them under "chunk" and the control plane
	// scored an envelope it was never asked to score.
	for _, direction := range []string{"pre", "post", "requst", ""} {
		t.Run("rejects the unknown direction "+strconv.Quote(direction), func(t *testing.T) {
			if _, err := contentFor(direction, []byte("x")); err == nil {
				t.Fatalf("contentFor(%q) must fail rather than guess a direction", direction)
			}
		})
	}
}

// controlPlaneRoot is the langwatch/ directory of the monorepo, relative to
// this package. A checkout that does not carry the TypeScript side (a vendored
// or split Go build) has no control plane to compare against and the test is
// skipped. When the directory IS there, a missing or unreadable file is drift,
// which is precisely what this test exists to catch, so it fails instead.
var controlPlaneRoot = filepath.Join("..", "..", "..", "..", "langwatch")

func readControlPlaneSource(t *testing.T, parts ...string) string {
	t.Helper()
	if _, err := os.Stat(filepath.Join(controlPlaneRoot, "src", "server")); err != nil {
		t.Skipf("control plane is not part of this checkout: %v", err)
	}
	path := filepath.Join(append([]string{controlPlaneRoot}, parts...)...)
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("control plane source %s is missing or unreadable, which means the two sides have drifted: %v", path, err)
	}
	return string(source)
}

// The control plane's Zod schema is the other half of the contract. Reading it
// here keeps a rename on the TypeScript side from silently breaking the gateway.
/** @scenario "the data plane and the control plane agree on the wire shape" */
func TestControlPlaneSchemaAgreesOnTheWireShape(t *testing.T) {
	text := readControlPlaneSource(t, "src", "server", "routes", "gateway-internal.ts")

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
	service := readControlPlaneSource(t, "src", "server", "gateway", "guardrailEvaluation.service.ts")
	for _, direction := range []string{"request", "response", "stream_chunk"} {
		if !strings.Contains(service, `"`+direction+`"`) {
			t.Errorf("control plane does not accept direction %q", direction)
		}
	}

	// Both sides must name the verdict field "decision" and agree on the values
	// it can carry. The Go struct read "action" once, which is absent from the
	// response, so every verdict fell through to allow.
	if !strings.Contains(service, "decision: GuardrailDecision") {
		t.Error("control plane verdict no longer names its field decision")
	}
	for _, decision := range controlPlaneDecisions(t, service) {
		verdict, err := verdictFor(guardrailCheckResponse{Decision: decision})
		if err != nil {
			t.Errorf("control plane can emit decision %q but the data plane rejects it: %v", decision, err)
			continue
		}
		if decision == "block" && verdict.Action != domain.GuardrailBlock {
			t.Errorf("decision block mapped to %v", verdict.Action)
		}
	}
	if _, err := verdictFor(guardrailCheckResponse{Decision: "approve"}); err == nil {
		t.Error("a decision the control plane cannot emit must be treated as drift, not allowed")
	}
}

// controlPlaneDecisions reads the GuardrailDecision union the control plane
// declares, so the values are never hardcoded twice.
func controlPlaneDecisions(t *testing.T, service string) []string {
	t.Helper()
	const marker = "export type GuardrailDecision ="
	start := strings.Index(service, marker)
	if start < 0 {
		t.Fatal("GuardrailDecision is no longer declared by the control plane")
	}
	end := strings.Index(service[start:], ";")
	if end < 0 {
		t.Fatal("could not delimit the GuardrailDecision union")
	}
	var decisions []string
	for _, part := range strings.Split(service[start+len(marker):start+end], "|") {
		decisions = append(decisions, strings.Trim(strings.TrimSpace(part), `"`))
	}
	if len(decisions) == 0 {
		t.Fatal("the GuardrailDecision union is empty")
	}
	return decisions
}
