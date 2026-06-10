// Harness for the prompt-spans integration tests. The wire-format
// helper (sdk-go/prompts) is unit-tested in sdk-go/prompts/prompts_test.go;
// the engine-side helper (emitPromptSpans) is unit-tested in
// services/nlpgo/app/engine/prompt_spans_emit_test.go. This file's job
// is to validate the DISPATCH BOUNDARY — that an HTTP request to
// /go/studio/execute_sync carrying a signature node bound to a saved
// prompt config actually causes the engine to call emitPromptSpans at
// the right point in runSignature, with the spans correctly parented
// under the per-node component span (so they end up as siblings of the
// LLM span the trace UI walks).
//
// Reuses installProductionTracerStack from causality_propagation_test.go
// (same package — integration_test) for the recorder + propagator
// setup, so prompt-span tests see the same global tracer wiring
// production runs against.
//
// Scope note: only 5 stubs flipped from t.Skip → real assertion in
// this PR (one per .feature file). The remaining 24 stubs stay t.Skip
// — they're parity-binder satisfied via the @scenario doc-comment
// but defer the real assertion until a regression demands it. Future
// PRs flip more as needed.

package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// (promptSpansPendingMsg is defined in prompt_spans_playground_test.go
// — same package, so all stubs share the same skip reason.)

// signatureNodeOpts shapes the signature node that gets embedded in
// the workflow JSON built by signatureWorkflowBody. Zero-value fields
// are omitted from the emitted node.data so the engine sees the same
// shape PromptStudioAdapter would send for an ad-hoc node (no
// configId), a saved-version node (configId + handle + versionMetadata),
// or a draft node (saved + promptDraft=true).
type signatureNodeOpts struct {
	NodeID        string
	NodeName      string
	ConfigID      string
	Handle        string
	VersionID     string
	VersionNumber int
	Draft         bool
	Instructions  string
	TemplateMsgs  []map[string]any
	// Origin sets the dispatch envelope's payload.origin. Defaults to
	// "workflow" (Studio Run-Component). Eval-v3 dispatches use
	// "evaluation"; the engine stamps it on langwatch.origin so the
	// trace-UI groups per-row prompt spans under the experiment surface.
	Origin string
}

// signatureWorkflowBody builds an execute_component envelope shaped
// like what PromptStudioAdapter / Studio Run-Component emits. The
// inputs map is what the engine resolves variables from; the
// templateMsgs / instructions sit on node.data.parameters per the
// Studio wire format.
func signatureWorkflowBody(t *testing.T, node signatureNodeOpts, inputs map[string]any) string {
	t.Helper()
	if node.NodeID == "" {
		node.NodeID = "prompt_node"
	}
	if node.NodeName == "" {
		node.NodeName = "LLM Node"
	}
	origin := node.Origin
	if origin == "" {
		origin = "workflow"
	}

	parameters := []map[string]any{
		{"identifier": "llm", "type": "llm", "value": map[string]any{
			"model":          "openai/gpt-5-mini",
			"litellm_params": map[string]any{"api_key": "k"},
		}},
	}
	if node.Instructions != "" {
		instrRaw, err := json.Marshal(node.Instructions)
		require.NoError(t, err)
		parameters = append(parameters, map[string]any{
			"identifier": "instructions", "type": "str",
			"value": json.RawMessage(instrRaw),
		})
	}
	if node.TemplateMsgs != nil {
		tmplRaw, err := json.Marshal(node.TemplateMsgs)
		require.NoError(t, err)
		parameters = append(parameters, map[string]any{
			"identifier": "messages", "type": "chat_messages",
			"value": json.RawMessage(tmplRaw),
		})
	}

	data := map[string]any{
		"name":       node.NodeName,
		"parameters": parameters,
		"inputs":     []map[string]any{{"identifier": "input", "type": "str"}},
		"outputs":    []map[string]any{{"identifier": "output", "type": "str"}},
	}
	if node.ConfigID != "" {
		data["configId"] = node.ConfigID
	}
	if node.Handle != "" {
		data["handle"] = node.Handle
	}
	if node.VersionID != "" || node.VersionNumber > 0 {
		data["versionMetadata"] = map[string]any{
			"versionId":     node.VersionID,
			"versionNumber": node.VersionNumber,
		}
	}
	if node.Draft {
		data["promptDraft"] = true
	}

	envelope := map[string]any{
		"type": "execute_component",
		"payload": map[string]any{
			"trace_id": "prompt-spans-" + node.NodeID,
			"node_id":  node.NodeID,
			"origin":   origin,
			"workflow": map[string]any{
				"workflow_id":      "wf_prompt_spans",
				"api_key":          "sk-prompt-spans",
				"spec_version":     "1.3",
				"name":             "Prompt Spans Harness",
				"icon":             "x",
				"description":      "x",
				"version":          "x",
				"template_adapter": "default",
				"nodes": []map[string]any{
					{"id": node.NodeID, "type": "signature", "data": data},
				},
				"edges": []any{},
				"state": map[string]any{},
			},
			"inputs": inputs,
		},
	}
	b, err := json.Marshal(envelope)
	require.NoError(t, err)
	return string(b)
}

// findPromptSpan returns the first span with the given name from the
// recorder, or nil.
func findPromptSpan(rec *tracetest.SpanRecorder, name string) sdktrace.ReadOnlySpan {
	for _, s := range rec.Ended() {
		if s.Name() == name {
			return s
		}
	}
	return nil
}

// findLLMSpan returns the first span carrying langwatch.span.type =
// "llm" from the recorded set, or nil. The LLM span is named after
// the model (e.g. "openai/gpt-5-mini"), so finding it by name is
// brittle — the type attribute is the stable identifier.
func findLLMSpan(spans []sdktrace.ReadOnlySpan) sdktrace.ReadOnlySpan {
	for _, s := range spans {
		for _, a := range s.Attributes() {
			if a.Key == "langwatch.span.type" && a.Value.AsString() == "llm" {
				return s
			}
		}
	}
	return nil
}

// promptSpanAttrs collects the langwatch.prompt.* attribute values
// off a span into a plain map. Identity attrs come back as strings
// (or int64 for version.number, bool for draft); the variables blob
// stays JSON-encoded for the caller to decode if needed.
func promptSpanAttrs(s sdktrace.ReadOnlySpan) map[string]any {
	out := map[string]any{}
	for _, a := range s.Attributes() {
		key := string(a.Key)
		switch a.Value.Type() {
		case attribute.STRING:
			out[key] = a.Value.AsString()
		case attribute.INT64:
			out[key] = a.Value.AsInt64()
		case attribute.BOOL:
			out[key] = a.Value.AsBool()
		default:
			out[key] = a.Value.AsInterface()
		}
	}
	return out
}

// runPromptSpansDispatch is the one-call entry point each prompt-
// spans integration test uses. It installs a recorder, stands up the
// pattern stack with a fake LLM that returns canned output, dispatches
// the envelope, and returns the recorder + LLM client for assertion.
//
// Tests should pass an envelope built with signatureWorkflowBody.
func runPromptSpansDispatch(t *testing.T, envelope string) (*promptSpansFixture, *app.WorkflowResult) {
	t.Helper()
	rec := installProductionTracerStack(t)
	llm := &fakeLLMClient{
		respond: func(_ app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: "ok"}, nil
		},
	}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	})
	res := postSync(t, &stack{url: url}, envelope)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	return &promptSpansFixture{rec: rec, llm: llm}, res
}

// promptSpansFixture bundles the recorder + LLM client a dispatched
// test wants to assert against. Both are zero-cost reads; the
// recorder snapshot is taken on each .Ended() call.
type promptSpansFixture struct {
	rec *tracetest.SpanRecorder
	llm *fakeLLMClient
}

// Spans returns the recorded spans (in End order).
func (f *promptSpansFixture) Spans() []sdktrace.ReadOnlySpan {
	return f.rec.Ended()
}

// FindPromptSpan returns the first span with the given name from the
// recorder, or fails the test.
func (f *promptSpansFixture) FindPromptSpan(t *testing.T, name string) sdktrace.ReadOnlySpan {
	t.Helper()
	s := findPromptSpan(f.rec, name)
	if s == nil {
		var names []string
		for _, sp := range f.rec.Ended() {
			names = append(names, sp.Name())
		}
		t.Fatalf("span %q not found among recorded spans: %v", name, names)
	}
	return s
}
