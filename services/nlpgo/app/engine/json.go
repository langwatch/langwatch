package engine

import (
	"encoding/json"
	"strings"
)

// jsonUnmarshalCompat is a small wrapper that gives us a single point
// to swap the JSON library if we ever switch to sonic for parity with
// the gateway's hot path.
func jsonUnmarshalCompat(b []byte, v any) error {
	return json.Unmarshal(b, v)
}

// stripJSONFence removes a single surrounding markdown code fence from s,
// e.g. "```json\n{...}\n```" -> "{...}". Models (notably Anthropic/Claude)
// wrap a JSON response in a fence even when a JSON response_format is
// requested, so the raw completion won't parse without this. Returns s
// unchanged when there is no leading fence.
func stripJSONFence(s string) string {
	trimmed := strings.TrimSpace(s)
	if !strings.HasPrefix(trimmed, "```") {
		return s
	}
	// Drop the opening fence line, including an optional language tag
	// (```json / ```JSON / ```).
	nl := strings.IndexByte(trimmed, '\n')
	if nl == -1 {
		return s
	}
	inner := trimmed[nl+1:]
	// Drop the trailing closing fence if present.
	if idx := strings.LastIndex(inner, "```"); idx != -1 {
		inner = inner[:idx]
	}
	return strings.TrimSpace(inner)
}

// extractFirstJSONObject returns the first balanced top-level {...} object in
// s, respecting string literals and escapes so braces inside strings don't
// confuse the scan. Mirrors DSPy's JSONAdapter fallback for completions that
// surround the JSON object with prose. Returns ("", false) when no balanced
// object is found.
func extractFirstJSONObject(s string) (string, bool) {
	start := strings.IndexByte(s, '{')
	if start == -1 {
		return "", false
	}
	depth := 0
	inStr := false
	escaped := false
	for i := start; i < len(s); i++ {
		c := s[i]
		if inStr {
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1], true
			}
		}
	}
	return "", false
}
