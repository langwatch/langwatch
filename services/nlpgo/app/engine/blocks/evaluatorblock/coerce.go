package evaluatorblock

import (
	"encoding/json"
	"fmt"
	"strconv"
)

// coerceScalar converts a single mapped evaluator input value into the form
// the langevals string-input schema expects. Parity with
// langwatch_nlp/studio/field_parser.py `autoparse_field_value` for
// `FieldType.str`: strings pass through, nil is preserved, every other shape
// is serialized to its JSON form.
//
// This restores at the Studio workflow boundary what the Python NLP era
// hid behind autoparse; without it a workflow that pipes a bool-emitting
// node into a string-input evaluator surfaces a Pydantic rejection.
func coerceScalar(v any) any {
	if v == nil {
		return nil
	}
	switch x := v.(type) {
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case json.Number:
		return x.String()
	case float64:
		// strconv with -1 prec emits the shortest round-trip form
		// (e.g. 42, 0.5) without trailing ".000000".
		return strconv.FormatFloat(x, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(x), 'f', -1, 32)
	case int:
		return strconv.Itoa(x)
	case int8:
		return strconv.FormatInt(int64(x), 10)
	case int16:
		return strconv.FormatInt(int64(x), 10)
	case int32:
		return strconv.FormatInt(int64(x), 10)
	case int64:
		return strconv.FormatInt(x, 10)
	case uint:
		return strconv.FormatUint(uint64(x), 10)
	case uint8:
		return strconv.FormatUint(uint64(x), 10)
	case uint16:
		return strconv.FormatUint(uint64(x), 10)
	case uint32:
		return strconv.FormatUint(uint64(x), 10)
	case uint64:
		return strconv.FormatUint(x, 10)
	}
	if b, err := json.Marshal(v); err == nil {
		return string(b)
	}
	return fmt.Sprintf("%v", v)
}

// coerceData walks an evaluator input payload and coerces each scalar field.
// Conversation arrays are recursed into so per-turn input/output are coerced
// too. Contexts arrays are left as-is — the langevals schema accepts either
// list[str] or list[RAGChunk], and per-element coercion happens at the
// langwatch app boundary if needed.
func coerceData(data map[string]any) map[string]any {
	if data == nil {
		return nil
	}
	out := make(map[string]any, len(data))
	for k, v := range data {
		switch k {
		case "contexts", "expected_contexts":
			out[k] = v
		case "conversation":
			out[k] = coerceConversation(v)
		default:
			out[k] = coerceScalar(v)
		}
	}
	return out
}

func coerceConversation(v any) any {
	arr, ok := v.([]any)
	if !ok {
		return v
	}
	out := make([]any, 0, len(arr))
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			out = append(out, item)
			continue
		}
		coerced := make(map[string]any, len(m))
		for k, val := range m {
			coerced[k] = coerceScalar(val)
		}
		out = append(out, coerced)
	}
	return out
}
