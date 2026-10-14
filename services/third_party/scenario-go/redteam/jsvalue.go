package redteam

import (
	"math"
	"strconv"
	"strings"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

// This file coerces parsed JSON values the way JavaScript's String() and
// Number() do, so the attacker and scorer outputs are read like the JS SDK
// reads them.

// member returns the value of key, the last one when a key repeats (like
// JSON.parse), and whether it exists.
func member(o jsjson.Object, key string) (any, bool) {
	for i := len(o) - 1; i >= 0; i-- {
		if o[i].Key == key {
			return o[i].Value, true
		}
	}
	return nil, false
}

// jsString is String(v ?? ""): missing and null values are "".
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case float64:
		var buf [32]byte
		return string(jsjson.AppendNumber(buf[:0], x))
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = jsString(e)
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// jsNumber is Number(v); NaN when v has no numeric reading.
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return math.NaN()
		}
		return f
	case []any:
		switch len(x) {
		case 0:
			return 0
		case 1:
			return jsNumber(jsString(x[0]))
		}
	}
	return math.NaN()
}

// truthy reports JavaScript truthiness.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0 && !math.IsNaN(x)
	}
	return true
}

// formatScore renders a score like a JavaScript number.
func formatScore(f float64) string {
	var buf [32]byte
	return string(jsjson.AppendNumber(buf[:0], f))
}
