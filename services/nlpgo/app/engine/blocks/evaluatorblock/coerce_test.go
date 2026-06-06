package evaluatorblock

import (
	"encoding/json"
	"math"
	"testing"
)

/** @scenario Non-string upstream outputs are coerced before dispatch */
func TestCoerceScalar(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want any
	}{
		{"nil preserved", nil, nil},
		{"string passthrough", "hello", "hello"},
		{"empty string passthrough", "", ""},
		{"true to 'true'", true, "true"},
		{"false to 'false'", false, "false"},
		{"int to decimal", 42, "42"},
		{"int64 to decimal", int64(-7), "-7"},
		{"float64 integer to '42'", float64(42), "42"},
		{"float64 to '0.5'", 0.5, "0.5"},
		{"json.Number passthrough as string", json.Number("12.5"), "12.5"},
		{"map to JSON", map[string]any{"a": 1}, `{"a":1}`},
		{"slice to JSON", []any{1, 2, 3}, `[1,2,3]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := coerceScalar(tc.in)
			if got != tc.want {
				t.Fatalf("coerceScalar(%v) = %v (%T), want %v (%T)", tc.in, got, got, tc.want, tc.want)
			}
		})
	}
}

func TestCoerceDataPreservesContextsAndConversation(t *testing.T) {
	in := map[string]any{
		"input":           true,
		"output":          float64(0.5),
		"expected_output": 1,
		"contexts":        []any{"a", "b"},
		"conversation": []any{
			map[string]any{"input": true, "output": 42},
			map[string]any{"input": "still", "output": "string"},
		},
	}
	out := coerceData(in)

	if out["input"] != "true" {
		t.Errorf("expected input='true', got %v", out["input"])
	}
	if out["output"] != "0.5" {
		t.Errorf("expected output='0.5', got %v", out["output"])
	}
	if out["expected_output"] != "1" {
		t.Errorf("expected expected_output='1', got %v", out["expected_output"])
	}
	if ctxs, ok := out["contexts"].([]any); !ok || len(ctxs) != 2 || ctxs[0] != "a" {
		t.Errorf("contexts should pass through unchanged, got %v", out["contexts"])
	}
	conv, ok := out["conversation"].([]any)
	if !ok || len(conv) != 2 {
		t.Fatalf("conversation lost shape: %v", out["conversation"])
	}
	turn0, _ := conv[0].(map[string]any)
	if turn0["input"] != "true" || turn0["output"] != "42" {
		t.Errorf("turn 0 not coerced: %v", turn0)
	}
}

func TestCoerceScalarNonFiniteFloats(t *testing.T) {
	cases := []struct {
		name string
		in   any
	}{
		{"NaN float64", math.NaN()},
		{"+Inf float64", math.Inf(1)},
		{"-Inf float64", math.Inf(-1)},
		{"NaN float32", float32(math.NaN())},
		{"+Inf float32", float32(math.Inf(1))},
		{"-Inf float32", float32(math.Inf(-1))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := coerceScalar(tc.in)
			if got != nil {
				t.Fatalf("coerceScalar(%v) = %v, want nil (parity with TS coerceEvaluatorScalar)", tc.in, got)
			}
		})
	}
}

/** @scenario Null upstream values are preserved, not coerced into a string */
func TestCoerceDataNil(t *testing.T) {
	if got := coerceData(nil); got != nil {
		t.Fatalf("coerceData(nil) = %v, want nil", got)
	}
}
