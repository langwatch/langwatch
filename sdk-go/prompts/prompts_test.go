// Tests pin the wire-format contract against python-sdk's
// prompt_service_tracing.py + prompt_tracing.py byte-for-byte. Any
// change here is a change to what trace consumers (TS
// findPromptReferenceInAncestors.ts, the trace drawer's "Open in
// Prompts" affordance) will see — coordinate before relaxing.
package prompts_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/langwatch/langwatch/sdk-go/internal/testutil"
	"github.com/langwatch/langwatch/sdk-go/prompts"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// installRecorder swaps the global tracer provider for one whose spans
// land in an in-memory recorder. Returns the recorder and a cleanup
// func that restores the prior provider. Mirrors python's
// fixtures.span_exporter.MockSpanExporter setup.
func installRecorder(t *testing.T) (*testutil.MockExporter, func()) {
	t.Helper()
	exporter := testutil.NewMockExporter()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exporter),
	)
	prior := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	return exporter, func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(prior)
	}
}

func findSpan(spans []sdktrace.ReadOnlySpan, name string) sdktrace.ReadOnlySpan {
	for _, s := range spans {
		if s.Name() == name {
			return s
		}
	}
	return nil
}

func attrString(s sdktrace.ReadOnlySpan, key attribute.Key) (string, bool) {
	for _, a := range s.Attributes() {
		if a.Key == key {
			return a.Value.AsString(), true
		}
	}
	return "", false
}

func attrInt(s sdktrace.ReadOnlySpan, key attribute.Key) (int64, bool) {
	for _, a := range s.Attributes() {
		if a.Key == key {
			return a.Value.AsInt64(), true
		}
	}
	return 0, false
}

func attrBool(s sdktrace.ReadOnlySpan, key attribute.Key) (bool, bool) {
	for _, a := range s.Attributes() {
		if a.Key == key {
			return a.Value.AsBool(), true
		}
	}
	return false, false
}

func attrMissing(t *testing.T, s sdktrace.ReadOnlySpan, key attribute.Key) {
	t.Helper()
	for _, a := range s.Attributes() {
		if a.Key == key {
			t.Fatalf("attribute %q should be absent but is set to %v", key, a.Value.AsInterface())
		}
	}
}

// PromptApiService.get tests — mirror python tests/prompts/
// test_prompt_service_tracing.py.

func TestEmitGet_RecordsCombinedIdWhenHandleAndVersionPresent(t *testing.T) {
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitGet(context.Background(), prompts.GetSpec{
		PromptID:      "pizza-prompt",
		Handle:        "pizza-prompt",
		VersionNumber: 6,
	})

	span := findSpan(rec.GetSpans(), "PromptApiService.get")
	if span == nil {
		t.Fatal("PromptApiService.get span not found")
	}
	id, ok := attrString(span, "langwatch.prompt.id")
	if !ok || id != "pizza-prompt:6" {
		t.Fatalf("langwatch.prompt.id = %q, want %q", id, "pizza-prompt:6")
	}
}

func TestEmitGet_OmitsCombinedIdWhenHandleMissing(t *testing.T) {
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitGet(context.Background(), prompts.GetSpec{
		PromptID:      "pizza-prompt",
		VersionNumber: 6,
		// Handle deliberately empty
	})

	span := findSpan(rec.GetSpans(), "PromptApiService.get")
	if span == nil {
		t.Fatal("PromptApiService.get span not found")
	}
	attrMissing(t, span, "langwatch.prompt.id")
}

func TestEmitGet_OmitsCombinedIdWhenVersionMissing(t *testing.T) {
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitGet(context.Background(), prompts.GetSpec{
		PromptID: "pizza-prompt",
		Handle:   "pizza-prompt",
		// VersionNumber zero (unresolved)
	})

	span := findSpan(rec.GetSpans(), "PromptApiService.get")
	if span == nil {
		t.Fatal("PromptApiService.get span not found")
	}
	attrMissing(t, span, "langwatch.prompt.id")
}

func TestEmitGet_VariablesEnvelopeMirrorsPython(t *testing.T) {
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitGet(context.Background(), prompts.GetSpec{
		PromptID: "pizza-prompt",
		Tag:      "production",
	})

	span := findSpan(rec.GetSpans(), "PromptApiService.get")
	if span == nil {
		t.Fatal("PromptApiService.get span not found")
	}
	raw, ok := attrString(span, "langwatch.prompt.variables")
	if !ok {
		t.Fatal("langwatch.prompt.variables attribute missing")
	}
	var decoded struct {
		Type  string         `json:"type"`
		Value map[string]any `json:"value"`
	}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatalf("variables payload not valid JSON: %v (%q)", err, raw)
	}
	if decoded.Type != "json" {
		t.Fatalf("variables.type = %q, want %q", decoded.Type, "json")
	}
	if decoded.Value["prompt_id"] != "pizza-prompt" {
		t.Fatalf("variables.value.prompt_id = %v, want %q", decoded.Value["prompt_id"], "pizza-prompt")
	}
	if decoded.Value["tag"] != "production" {
		t.Fatalf("variables.value.tag = %v, want %q", decoded.Value["tag"], "production")
	}
}

// Prompt.compile tests — mirror python tests/prompts/test_prompt_tracing.py.

func TestEmitCompile_RecordsFullIdentity(t *testing.T) {
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitCompile(context.Background(), prompts.CompileSpec{
		PromptID:      "prompt_4RXLJtB9Cj-OA1BaLpxWc",
		Handle:        "pizza-prompt",
		VersionID:     "prompt_version_I21kDsHKtr5wQm9k1Dap2",
		VersionNumber: 6,
		Variables:     map[string]any{"foo": "bar"},
	})

	span := findSpan(rec.GetSpans(), "Prompt.compile")
	if span == nil {
		t.Fatal("Prompt.compile span not found")
	}
	if v, _ := attrString(span, "langwatch.prompt.id"); v != "prompt_4RXLJtB9Cj-OA1BaLpxWc" {
		t.Fatalf("prompt.id = %q", v)
	}
	if v, _ := attrString(span, "langwatch.prompt.handle"); v != "pizza-prompt" {
		t.Fatalf("prompt.handle = %q", v)
	}
	if v, _ := attrString(span, "langwatch.prompt.version.id"); v != "prompt_version_I21kDsHKtr5wQm9k1Dap2" {
		t.Fatalf("prompt.version.id = %q", v)
	}
	if v, _ := attrInt(span, "langwatch.prompt.version.number"); v != 6 {
		t.Fatalf("prompt.version.number = %d", v)
	}
	raw, ok := attrString(span, "langwatch.prompt.variables")
	if !ok {
		t.Fatal("variables missing")
	}
	var decoded struct {
		Type  string         `json:"type"`
		Value map[string]any `json:"value"`
	}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatalf("variables JSON: %v", err)
	}
	if decoded.Type != "json" || decoded.Value["foo"] != "bar" {
		t.Fatalf("variables = %+v", decoded)
	}
}

func TestEmitCompile_OmitsIdentityWhenUnset(t *testing.T) {
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitCompile(context.Background(), prompts.CompileSpec{
		Variables: map[string]any{"foo": "bar"},
	})

	span := findSpan(rec.GetSpans(), "Prompt.compile")
	if span == nil {
		t.Fatal("span not found")
	}
	attrMissing(t, span, "langwatch.prompt.id")
	attrMissing(t, span, "langwatch.prompt.handle")
	attrMissing(t, span, "langwatch.prompt.version.id")
	attrMissing(t, span, "langwatch.prompt.version.number")
	attrMissing(t, span, "langwatch.prompt.draft")
}

func TestEmitCompile_DraftFlagIsSetWhenTrue(t *testing.T) {
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitCompile(context.Background(), prompts.CompileSpec{
		PromptID:      "prompt_x",
		Handle:        "support-router",
		VersionNumber: 6,
		Variables:     map[string]any{},
		Draft:         true,
	})

	span := findSpan(rec.GetSpans(), "Prompt.compile")
	if span == nil {
		t.Fatal("span not found")
	}
	v, ok := attrBool(span, "langwatch.prompt.draft")
	if !ok || !v {
		t.Fatalf("langwatch.prompt.draft = (%v, ok=%v), want true", v, ok)
	}
	// Base identity stays populated as the resume target — the draft
	// flag is additive, not a substitute.
	if v, _ := attrString(span, "langwatch.prompt.handle"); v != "support-router" {
		t.Fatalf("base handle dropped on draft: %q", v)
	}
	if v, _ := attrInt(span, "langwatch.prompt.version.number"); v != 6 {
		t.Fatalf("base version dropped on draft: %d", v)
	}
}

func TestEmitCompile_DraftFlagIsAbsentWhenFalse(t *testing.T) {
	// Mirrors python's _set_attribute_if_not_none semantics: absent !=
	// "false". The spec's "saved-version execution does NOT emit a draft
	// attribute (omission, not false)" scenario is pinned here.
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitCompile(context.Background(), prompts.CompileSpec{
		Handle:        "support-router",
		VersionNumber: 6,
		Variables:     map[string]any{},
		Draft:         false,
	})

	span := findSpan(rec.GetSpans(), "Prompt.compile")
	if span == nil {
		t.Fatal("span not found")
	}
	attrMissing(t, span, "langwatch.prompt.draft")
}

func TestEmitCompile_VariablesEmptyWhenNoInputs(t *testing.T) {
	// Pins the spec line we negotiated with rchaves: fresh-adhoc compile
	// records variables = {type:json,value:{}} (python parity, NOT a
	// synthesized {input:<live chat>}).
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitCompile(context.Background(), prompts.CompileSpec{})

	span := findSpan(rec.GetSpans(), "Prompt.compile")
	if span == nil {
		t.Fatal("span not found")
	}
	raw, ok := attrString(span, "langwatch.prompt.variables")
	if !ok {
		t.Fatal("variables attribute missing")
	}
	if raw != `{"type":"json","value":{}}` {
		t.Fatalf("variables = %q, want %q", raw, `{"type":"json","value":{}}`)
	}
}

func TestEmitCompile_DropsNonSerializableEntriesBestEffort(t *testing.T) {
	// Spec: "non-JSON-serializable values are stringified, dispatch
	// still succeeds" — we drop unserializable entries rather than fail
	// the whole emission, so the serializable subset survives on the
	// span.
	rec, done := installRecorder(t)
	defer done()

	prompts.EmitCompile(context.Background(), prompts.CompileSpec{
		Variables: map[string]any{
			"name":     "Alice",
			"callback": func() {}, // unserializable
		},
	})

	span := findSpan(rec.GetSpans(), "Prompt.compile")
	if span == nil {
		t.Fatal("span not found")
	}
	raw, _ := attrString(span, "langwatch.prompt.variables")
	var decoded struct {
		Value map[string]any `json:"value"`
	}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatalf("variables JSON: %v", err)
	}
	if decoded.Value["name"] != "Alice" {
		t.Fatalf("serializable key dropped: %+v", decoded.Value)
	}
	if _, present := decoded.Value["callback"]; present {
		t.Fatalf("unserializable key not dropped: %+v", decoded.Value)
	}
}
