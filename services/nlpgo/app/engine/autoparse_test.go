package engine

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

func TestAutoparseValue(t *testing.T) {
	cases := []struct {
		name string
		in   any
		ft   dsl.FieldType
		want any
	}{
		{"float from int string", "1", dsl.FieldTypeFloat, float64(1)},
		{"float with decimal", "2.5", dsl.FieldTypeFloat, float64(2.5)},
		{"float trims whitespace", " 3 ", dsl.FieldTypeFloat, float64(3)},
		{"int from string", "3", dsl.FieldTypeInt, int64(3)},
		{"int from integral float string", "4.0", dsl.FieldTypeInt, int64(4)},
		{"bool true", "true", dsl.FieldTypeBool, true},
		{"bool false", "false", dsl.FieldTypeBool, false},
		{"str passes through", "hello", dsl.FieldTypeStr, "hello"},
		{"already-typed value untouched", float64(7), dsl.FieldTypeFloat, float64(7)},
		{"unparseable float left as string", "n/a", dsl.FieldTypeFloat, "n/a"},
		{"image left as string", "https://x/y.png", dsl.FieldTypeImage, "https://x/y.png"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, autoparseValue(c.in, c.ft))
		})
	}
}

func TestAutoparseValue_ListAndDict(t *testing.T) {
	assert.Equal(t,
		[]any{float64(1), float64(2), float64(3)},
		autoparseValue("[1, 2, 3]", dsl.FieldTypeList),
	)
	assert.Equal(t,
		map[string]any{"a": float64(1)},
		autoparseValue(`{"a": 1}`, dsl.FieldTypeDict),
	)
	// Invalid JSON is left as the original string.
	assert.Equal(t, "not json", autoparseValue("not json", dsl.FieldTypeList))
}

func TestAutoparseInputs_OnlyDeclaredFields(t *testing.T) {
	out := autoparseInputs(
		map[string]any{"amount": "1", "note": "keep"},
		[]dsl.Field{{Identifier: "amount", Type: dsl.FieldTypeFloat}},
	)
	assert.Equal(t, float64(1), out["amount"])
	// An input with no declared field type is passed through untouched.
	assert.Equal(t, "keep", out["note"])
}
