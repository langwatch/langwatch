package engine

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// autoparseInputs coerces string-typed input values into the shape a
// node's declared input types imply, so Python code blocks and if/else
// conditions receive real numbers, bools, lists and dicts instead of the
// raw strings that datasets and form fields carry. A dataset cell of "1"
// feeding an input declared `float` becomes 1.0, so user code like
// `amount > 5` works instead of raising "'>' not supported between str
// and int".
//
// This restores the langwatch_nlp field_parser.autoparse_field_value
// behavior the Go engine otherwise dropped. Only string values are
// touched (values already typed by an upstream node pass through), and a
// value that cannot be parsed into its declared type is left as-is so the
// user code, not the engine, decides what to do with it.
func autoparseInputs(inputs map[string]any, fields []dsl.Field) map[string]any {
	if len(inputs) == 0 || len(fields) == 0 {
		return inputs
	}
	typeByName := make(map[string]dsl.FieldType, len(fields))
	for _, f := range fields {
		typeByName[f.Identifier] = f.Type
	}
	out := make(map[string]any, len(inputs))
	for k, v := range inputs {
		if ft, ok := typeByName[k]; ok {
			out[k] = autoparseValue(v, ft)
		} else {
			out[k] = v
		}
	}
	return out
}

func autoparseValue(v any, ft dsl.FieldType) any {
	s, ok := v.(string)
	if !ok {
		return v // already typed by an upstream node
	}
	trimmed := strings.TrimSpace(s)
	switch ft {
	case dsl.FieldTypeFloat:
		if f, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return f
		}
	case dsl.FieldTypeInt:
		if n, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return n
		}
		// Tolerate integral floats like "1.0".
		if f, err := strconv.ParseFloat(trimmed, 64); err == nil && f == float64(int64(f)) {
			return int64(f)
		}
	case dsl.FieldTypeBool:
		if b, err := strconv.ParseBool(trimmed); err == nil {
			return b
		}
	case dsl.FieldTypeList, dsl.FieldTypeListStr, dsl.FieldTypeListFloat,
		dsl.FieldTypeListInt, dsl.FieldTypeListBool, dsl.FieldTypeDict:
		var parsed any
		if json.Unmarshal([]byte(trimmed), &parsed) == nil {
			return parsed
		}
	}
	return v
}
