package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestDecodeStudioClientEvent_DoNotTrace_FromEnvelope pins that an
// envelope-level `do_not_trace=true` reaches WorkflowRequest.DoNotTrace.
// This is what Python CustomNode.forward + Go agentblock.WorkflowRunner
// inject on /api/workflows/<id>/run bodies to suppress double-counted
// trace spans against the parent workflow's span.
func TestDecodeStudioClientEvent_DoNotTrace_FromEnvelope(t *testing.T) {
	body := []byte(`{
		"type": "execute_flow",
		"payload": {
			"trace_id": "abc",
			"workflow": {"workflow_id": "wf", "api_key": "k", "spec_version": "1.3"},
			"do_not_trace": true
		}
	}`)
	r := httptest.NewRequest("POST", "/", strings.NewReader(string(body)))
	req, herrErr := decodeStudioClientEvent(r, body)
	if herrErr != nil {
		t.Fatalf("decode failed: %v", herrErr)
	}
	if !req.DoNotTrace {
		t.Errorf("DoNotTrace = false, want true (envelope event.do_not_trace propagation)")
	}
}

// TestDecodeStudioClientEvent_DoNotTrace_FromEnableTracingFalse pins
// that `workflow.enable_tracing=false` flips WorkflowRequest.DoNotTrace
// on. Mirrors Python's `not workflow.enable_tracing` branch in
// execute_flow.py:53. Customer-facing: a workflow saved with
// enable_tracing=false should not emit traces on the Go path.
func TestDecodeStudioClientEvent_DoNotTrace_FromEnableTracingFalse(t *testing.T) {
	body := []byte(`{
		"type": "execute_flow",
		"payload": {
			"trace_id": "abc",
			"workflow": {"workflow_id": "wf", "api_key": "k", "spec_version": "1.3", "enable_tracing": false}
		}
	}`)
	r := httptest.NewRequest("POST", "/", strings.NewReader(string(body)))
	req, herrErr := decodeStudioClientEvent(r, body)
	if herrErr != nil {
		t.Fatalf("decode failed: %v", herrErr)
	}
	if !req.DoNotTrace {
		t.Errorf("DoNotTrace = false, want true (workflow.enable_tracing=false should suppress)")
	}
}

// TestDecodeStudioClientEvent_DoNotTrace_DefaultsFalse pins the happy
// path: when neither envelope.do_not_trace nor workflow.enable_tracing
// is set, DoNotTrace is false (engine emits the studio span as
// usual). Mirrors Python where enable_tracing defaults to true and
// event.do_not_trace defaults to false.
func TestDecodeStudioClientEvent_DoNotTrace_DefaultsFalse(t *testing.T) {
	body := []byte(`{
		"type": "execute_flow",
		"payload": {
			"trace_id": "abc",
			"workflow": {"workflow_id": "wf", "api_key": "k", "spec_version": "1.3"}
		}
	}`)
	r := httptest.NewRequest("POST", "/", strings.NewReader(string(body)))
	req, herrErr := decodeStudioClientEvent(r, body)
	if herrErr != nil {
		t.Fatalf("decode failed: %v", herrErr)
	}
	if req.DoNotTrace {
		t.Errorf("DoNotTrace = true, want false (no opt-out, no enable_tracing override)")
	}
}

// TestPeekWorkflowEnableTracing pins the typed-default contract: the
// helper returns true for missing field, true for explicit true,
// false for explicit false, and true on any parse error so a
// malformed workflow doesn't accidentally suppress all observability.
func TestPeekWorkflowEnableTracing(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"missing", `{}`, true},
		{"explicit_true", `{"enable_tracing": true}`, true},
		{"explicit_false", `{"enable_tracing": false}`, false},
		{"malformed_json", `{"enable_tracing": fals`, true},
		{"empty", ``, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := peekWorkflowEnableTracing(json.RawMessage(tc.in))
			if got != tc.want {
				t.Errorf("peekWorkflowEnableTracing(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
