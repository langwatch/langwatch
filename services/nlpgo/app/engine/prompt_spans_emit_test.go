// Unit tests for emitPromptSpans — the helper that stamps the
// PromptApiService.get + Prompt.compile span pair before a signature
// node's LLM call. These tests pin the per-attribute wire format
// against the python-sdk reference shape (prompt_service_tracing.py +
// prompt_tracing.py) so a drift on either side surfaces as a test
// failure, not as a silent trace-UI regression.
//
// The HTTP-level emission scenarios (saved-version path, draft path,
// per-row scoping in eval-v3, etc.) live under services/nlpgo/tests/
// integration/prompt_spans_*_test.go and bind to the .feature files in
// specs/nlp-go/. This file is the inner-loop guard for the helper
// itself.

package engine

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

const (
	testPromptConfigID   = "prompt_4RXLJtB9Cj-OA1BaLpxWc"
	testPromptHandle     = "pizza-prompt"
	testPromptVersionID  = "prompt_version_I21kDsHKtr5wQm9k1Dap2"
	testPromptVersionNum = 6
	testPromptCreatedAt  = "2026-05-01T12:00:00Z"
)

func signatureNodeWithPromptConfig(setup func(*dsl.Component)) *dsl.Node {
	cfg := testPromptConfigID
	hdl := testPromptHandle
	data := dsl.Component{
		PromptConfigID: &cfg,
		PromptHandle:   &hdl,
		VersionMetadata: &dsl.PromptVersionMetadata{
			VersionID:        testPromptVersionID,
			VersionNumber:    testPromptVersionNum,
			VersionCreatedAt: testPromptCreatedAt,
		},
	}
	if setup != nil {
		setup(&data)
	}
	return &dsl.Node{ID: "sig-1", Type: dsl.ComponentSignature, Data: data}
}

func TestEmitPromptSpans_SavedVersionEmitsBothSpansWithFullIdentity(t *testing.T) {
	rec := withRecorder(t)

	node := signatureNodeWithPromptConfig(nil)
	emitPromptSpans(context.Background(), node, map[string]any{"input": "I want a refund"})

	ended := rec.Ended()
	require.Len(t, ended, 2, "expected exactly PromptApiService.get + Prompt.compile (no LLM yet)")

	// Order is deterministic: get ends first (called first), then compile.
	got, compile := ended[0], ended[1]
	assert.Equal(t, "PromptApiService.get", got.Name())
	assert.Equal(t, "Prompt.compile", compile.Name())

	// PromptApiService.get: combined id + variables envelope.
	getAttrs := attrMap(got.Attributes())
	assert.Equal(t, "pizza-prompt:6", getAttrs["langwatch.prompt.id"])
	assert.JSONEq(t,
		`{"type":"json","value":{"prompt_id":"prompt_4RXLJtB9Cj-OA1BaLpxWc"}}`,
		getAttrs["langwatch.prompt.variables"].(string),
	)

	// Prompt.compile: full 4-attr identity + variables + NO draft (saved).
	compileAttrs := attrMap(compile.Attributes())
	assert.Equal(t, testPromptConfigID, compileAttrs["langwatch.prompt.id"])
	assert.Equal(t, testPromptHandle, compileAttrs["langwatch.prompt.handle"])
	assert.Equal(t, testPromptVersionID, compileAttrs["langwatch.prompt.version.id"])
	assert.Equal(t, int64(6), compileAttrs["langwatch.prompt.version.number"])
	assert.JSONEq(t,
		`{"type":"json","value":{"input":"I want a refund"}}`,
		compileAttrs["langwatch.prompt.variables"].(string),
	)
	assert.NotContains(t, compileAttrs, "langwatch.prompt.draft",
		"saved-version execution must OMIT langwatch.prompt.draft (not set to false) per python-sdk's _set_attribute_if_not_none convention")
}

func TestEmitPromptSpans_DraftPreservesBaseIdentityPlusFlag(t *testing.T) {
	rec := withRecorder(t)

	draft := true
	node := signatureNodeWithPromptConfig(func(c *dsl.Component) { c.PromptDraft = &draft })
	emitPromptSpans(context.Background(), node, map[string]any{"input": "test"})

	ended := rec.Ended()
	require.Len(t, ended, 2)

	compileAttrs := attrMap(ended[1].Attributes())
	// Base identity still on the span — trace-UI uses this for "Open in Prompts".
	assert.Equal(t, testPromptConfigID, compileAttrs["langwatch.prompt.id"])
	assert.Equal(t, testPromptHandle, compileAttrs["langwatch.prompt.handle"])
	assert.Equal(t, int64(6), compileAttrs["langwatch.prompt.version.number"])
	// Draft flag stamped so trace-UI labels it "(unsaved edits)".
	assert.Equal(t, true, compileAttrs["langwatch.prompt.draft"])
}

func TestEmitPromptSpans_NoConfigIdMeansNoSpans(t *testing.T) {
	rec := withRecorder(t)

	// Plain text-in/text-out signature node: no configId means no
	// prompt-ancestry. The engine emits zero prompt spans so the LLM
	// span's drawer shows "Create new prompt" rather than a stale
	// "Open in Prompts" deep-link.
	node := &dsl.Node{ID: "sig-1", Type: dsl.ComponentSignature, Data: dsl.Component{}}
	emitPromptSpans(context.Background(), node, map[string]any{"input": "x"})

	assert.Empty(t, rec.Ended(), "no configId → zero prompt spans")
}

func TestEmitPromptSpans_PartialIdentityOmitsCombinedId(t *testing.T) {
	rec := withRecorder(t)

	// Handle resolved but no VersionMetadata → can't form "handle:N".
	// python prompt_service_tracing.py:53 guards this case: combined id
	// is stamped only when both handle and version are set.
	node := signatureNodeWithPromptConfig(func(c *dsl.Component) { c.VersionMetadata = nil })
	emitPromptSpans(context.Background(), node, nil)

	ended := rec.Ended()
	require.Len(t, ended, 2)

	getAttrs := attrMap(ended[0].Attributes())
	assert.NotContains(t, getAttrs, "langwatch.prompt.id",
		"combined id must be omitted when version is unresolved")
	// Variables envelope still emits with prompt_id input.
	assert.JSONEq(t,
		`{"type":"json","value":{"prompt_id":"prompt_4RXLJtB9Cj-OA1BaLpxWc"}}`,
		getAttrs["langwatch.prompt.variables"].(string),
	)

	// Compile span: id + handle present, version.* absent.
	compileAttrs := attrMap(ended[1].Attributes())
	assert.Equal(t, testPromptConfigID, compileAttrs["langwatch.prompt.id"])
	assert.Equal(t, testPromptHandle, compileAttrs["langwatch.prompt.handle"])
	assert.NotContains(t, compileAttrs, "langwatch.prompt.version.id")
	assert.NotContains(t, compileAttrs, "langwatch.prompt.version.number")
}

func TestEmitPromptSpans_EmptyInputsRecordsEmptyVariablesMap(t *testing.T) {
	rec := withRecorder(t)

	// Python prompt.compile() with no kwargs records {} on the span —
	// not null, not absent. Pinned by the playground fresh-adhoc spec
	// scenario we negotiated with rchaves.
	node := signatureNodeWithPromptConfig(nil)
	emitPromptSpans(context.Background(), node, nil)

	ended := rec.Ended()
	require.Len(t, ended, 2)

	compileAttrs := attrMap(ended[1].Attributes())
	assert.JSONEq(t, `{"type":"json","value":{}}`, compileAttrs["langwatch.prompt.variables"].(string))
}

// Regression for the 2026-05-17 prod report (#4094 post-merge dogfood):
// the playground forwarder injects `messages` (and the studio path
// `chat_messages`) alongside user template variables in the signature
// node's `inputs` map. Both are dispatch envelope, not user vars —
// surfacing them on `langwatch.prompt.variables` makes the trace-UI
// resume render them as Variables-panel rows ("messages = [object
// Object]"). Filter them out at the emit boundary; legitimate user
// vars in the same payload must pass through untouched.
func TestEmitPromptSpans_FiltersDispatchEnvelopeKeysFromCompileVariables(t *testing.T) {
	rec := withRecorder(t)

	node := signatureNodeWithPromptConfig(nil)
	emitPromptSpans(context.Background(), node, map[string]any{
		"input":   "how big is mars?",
		"example": "foobar",
		"messages": []any{
			map[string]any{"role": "user", "content": "{{input}}"},
		},
		"chat_messages": []any{
			map[string]any{"role": "assistant", "content": "prior turn"},
		},
	})

	ended := rec.Ended()
	require.Len(t, ended, 2)

	compileAttrs := attrMap(ended[1].Attributes())
	assert.JSONEq(t,
		`{"type":"json","value":{"example":"foobar","input":"how big is mars?"}}`,
		compileAttrs["langwatch.prompt.variables"].(string),
		"messages + chat_messages are dispatch envelope and must be stripped from langwatch.prompt.variables; user vars (input, example) must survive",
	)
}

func TestEmitPromptSpans_GetCompileAreSiblingsUnderSameParent(t *testing.T) {
	rec := withRecorder(t)

	// Open an outer span so emitPromptSpans's tracer.Start inherits it
	// as parent. The resulting trace must have get + compile sharing
	// the SAME parent — python opens each with start_as_current_span
	// from the current context, NOT nested inside one another.
	tracer := otel.Tracer("engine-test")
	ctx, parent := tracer.Start(context.Background(), "engine.runSignature")
	defer parent.End()

	node := signatureNodeWithPromptConfig(nil)
	emitPromptSpans(ctx, node, map[string]any{"input": "hi"})

	ended := rec.Ended()
	require.Len(t, ended, 2)

	getSpan, compileSpan := ended[0], ended[1]
	parentSC := parent.SpanContext()

	assert.True(t, getSpan.Parent().IsValid())
	assert.Equal(t, parentSC.SpanID(), getSpan.Parent().SpanID(),
		"PromptApiService.get parent must be the engine.runSignature span, not nested inside another prompt span")
	assert.Equal(t, parentSC.SpanID(), compileSpan.Parent().SpanID(),
		"Prompt.compile parent must be the engine.runSignature span (sibling of get, not nested inside it)")
}
