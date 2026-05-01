package engine

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestSignatureNeedsStructuredOutput pins the policy: structured
// response_format is requested when (a) any output is json_schema-typed
// or (b) there are 2+ outputs (multi-output requires field separation).
func TestSignatureNeedsStructuredOutput(t *testing.T) {
	cases := []struct {
		name string
		out  []dsl.Field
		want bool
	}{
		{"single str", []dsl.Field{{Identifier: "a", Type: dsl.FieldTypeStr}}, false},
		{"single int", []dsl.Field{{Identifier: "n", Type: dsl.FieldTypeInt}}, false},
		{"single json_schema", []dsl.Field{{Identifier: "o", Type: dsl.FieldTypeJSONSchema}}, true},
		{"two str", []dsl.Field{{Identifier: "a"}, {Identifier: "b"}}, true},
		{"three mixed", []dsl.Field{{Identifier: "a"}, {Identifier: "b"}, {Identifier: "c"}}, true},
		{"empty", []dsl.Field{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, signatureNeedsStructuredOutput(tc.out))
		})
	}
}

func TestComposeSignatureResponseFormat_TwoStringOutputs(t *testing.T) {
	rf := composeSignatureResponseFormat("Classify", []dsl.Field{
		{Identifier: "label", Type: dsl.FieldTypeStr},
		{Identifier: "confidence", Type: dsl.FieldTypeFloat},
	})
	require.NotNil(t, rf)
	assert.Equal(t, "json_schema", rf.Type)
	js := rf.JSONSchema
	assert.Equal(t, "Classify", js["name"])
	assert.Equal(t, true, js["strict"])
	schema := js["schema"].(map[string]any)
	assert.Equal(t, "object", schema["type"])
	assert.Equal(t, false, schema["additionalProperties"])
	props := schema["properties"].(map[string]any)
	assert.Equal(t, map[string]any{"type": "string"}, props["label"])
	assert.Equal(t, map[string]any{"type": "number"}, props["confidence"])
	required := schema["required"].([]string)
	assert.ElementsMatch(t, []string{"label", "confidence"}, required)
}

// TestComposeSignatureResponseFormat_JSONSchemaPassthrough proves a
// json_schema-typed output's full schema is forwarded verbatim — the
// engine doesn't try to re-derive a minimal type-only one.
func TestComposeSignatureResponseFormat_JSONSchemaPassthrough(t *testing.T) {
	customer := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name": map[string]any{"type": "string"},
			"age":  map[string]any{"type": "integer"},
		},
		"required": []any{"name", "age"},
	}
	rf := composeSignatureResponseFormat("Person", []dsl.Field{
		{Identifier: "person", Type: dsl.FieldTypeJSONSchema, JSONSchema: customer},
	})
	require.NotNil(t, rf)
	props := rf.JSONSchema["schema"].(map[string]any)["properties"].(map[string]any)
	assert.Equal(t, customer, props["person"], "json_schema field must round-trip its schema verbatim")
}

func TestExtractSignatureOutputs_HappyPath(t *testing.T) {
	outputs := []dsl.Field{
		{Identifier: "label", Type: dsl.FieldTypeStr},
		{Identifier: "confidence", Type: dsl.FieldTypeFloat},
	}
	content := `{"label":"weather","confidence":0.93}`
	got, warnings := extractSignatureOutputs(content, outputs)
	assert.Empty(t, warnings)
	assert.Equal(t, "weather", got["label"])
	assert.InDelta(t, 0.93, got["confidence"], 1e-9)
}

func TestExtractSignatureOutputs_FallbackOnNonJSON(t *testing.T) {
	outputs := []dsl.Field{
		{Identifier: "answer", Type: dsl.FieldTypeStr},
		{Identifier: "explanation", Type: dsl.FieldTypeStr},
	}
	got, warnings := extractSignatureOutputs("just plain text, not json", outputs)
	require.NotEmpty(t, warnings, "expected a warning when the response isn't JSON")
	assert.Equal(t, "just plain text, not json", got["answer"],
		"fallback should put the raw content into the first declared output")
	_, ok := got["explanation"]
	assert.False(t, ok, "second output should be absent when fallback fires")
}

// TestExtractSignatureOutputs_MissingFieldWarns proves the helper
// surfaces missing-field warnings so callers can surface them — the
// engine intentionally doesn't fail the run; downstream nodes get a
// nil/zero for the missing output and the workflow continues.
func TestExtractSignatureOutputs_MissingFieldWarns(t *testing.T) {
	outputs := []dsl.Field{
		{Identifier: "a", Type: dsl.FieldTypeStr},
		{Identifier: "b", Type: dsl.FieldTypeStr},
	}
	content := `{"a":"present"}` // b is missing
	got, warnings := extractSignatureOutputs(content, outputs)
	assert.Equal(t, "present", got["a"])
	_, ok := got["b"]
	assert.False(t, ok, "missing field should not be set")
	require.NotEmpty(t, warnings)
	assert.Contains(t, warnings[0], `"b"`)
}

func TestJSONSchemaForField_ScalarMappings(t *testing.T) {
	cases := []struct {
		ft   dsl.FieldType
		want string
	}{
		{dsl.FieldTypeStr, "string"},
		{dsl.FieldTypeInt, "integer"},
		{dsl.FieldTypeFloat, "number"},
		{dsl.FieldTypeBool, "boolean"},
		{dsl.FieldTypeList, "array"},
		{dsl.FieldTypeListStr, "array"},
		{dsl.FieldTypeDict, "object"},
		{"unknown_type", "string"}, // defensive default
	}
	for _, tc := range cases {
		t.Run(string(tc.ft), func(t *testing.T) {
			got := jsonSchemaForField(dsl.Field{Type: tc.ft})
			assert.Equal(t, tc.want, got["type"])
		})
	}
}

// TestJSONSchemaForField_JSONSchemaWithEmptySchemaFallsBack proves a
// json_schema field with no attached schema falls back to a string type
// rather than emitting an empty schema (which provider validators
// would reject).
func TestJSONSchemaForField_JSONSchemaWithEmptySchemaFallsBack(t *testing.T) {
	got := jsonSchemaForField(dsl.Field{Type: dsl.FieldTypeJSONSchema})
	assert.Equal(t, "string", got["type"])
}

// TestSanitizeSchemaName pins the OpenAI name-pattern compliance:
// response_format.json_schema.name must match ^[a-zA-Z0-9_-]+$ and is
// capped at 64 chars. Without this, node names containing dots or
// spaces (e.g. "LLM Call") and models with dots (e.g. "gpt-5.2") cause
// OpenAI to reject the request — observed in rchaves dogfood
// 2026-04-29 (workflow_qtBZcCf4ch5xfxBm-NIZL): `Invalid
// 'response_format.json_schema.name': string does not match pattern
// '^[a-zA-Z0-9_-]+$'`.
func TestSanitizeSchemaName(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"alphanumeric passthrough", "ClassifyOutputs", "ClassifyOutputs"},
		{"underscore allowed", "my_node_Outputs", "my_node_Outputs"},
		{"dash allowed", "node-abc-Outputs", "node-abc-Outputs"},
		{"space replaced", "LLM Call Outputs", "LLM_Call_Outputs"},
		{"dot replaced", "gpt-5.2Outputs", "gpt-5_2Outputs"},
		{"colon replaced", "node:42Outputs", "node_42Outputs"},
		{"unicode replaced", "résumé_Outputs", "r_sum__Outputs"},
		{"empty falls back", "", "Outputs"},
		{"all illegal falls back", "...", "Outputs"},
		{"truncated to 64", strings.Repeat("a", 100), strings.Repeat("a", 64)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeSchemaName(tc.in)
			assert.Equal(t, tc.want, got)
			assert.Regexp(t, `^[a-zA-Z0-9_-]+$`, got, "must satisfy OpenAI name pattern")
			assert.LessOrEqual(t, len(got), 64, "must be at most 64 chars")
		})
	}
}

// TestComposeSignatureResponseFormat_RoundTripsThroughJSON proves the
// composed response_format JSON-marshals cleanly — important because
// it travels through llmexecutor and lands in the gateway request body.
// A map[string]any with a non-marshalable value would fail at runtime.
func TestComposeSignatureResponseFormat_RoundTripsThroughJSON(t *testing.T) {
	rf := composeSignatureResponseFormat("Outputs", []dsl.Field{
		{Identifier: "a", Type: dsl.FieldTypeStr},
		{Identifier: "b", Type: dsl.FieldTypeInt},
	})
	raw, err := json.Marshal(rf)
	require.NoError(t, err)
	var back map[string]any
	require.NoError(t, json.Unmarshal(raw, &back))
	assert.Equal(t, "json_schema", back["type"])
	js := back["json_schema"].(map[string]any)
	assert.Equal(t, "Outputs", js["name"])
}
