package apidiff

import "regexp"

// Ruled: a REST error body carries type, code and message at the root (ARCHITECTURE.md:2566).
const rulingErrorEnvelope = "a REST error body carries its fields at the root in one envelope (ARCHITECTURE.md:2566, Alex 2026-09-30; error envelopes in transports deleted, :2689)"

var errorCodeSpelling = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// ruleErrorEnvelope rules an error-body shape change when the branch answered the canonical
// root envelope and main's body, where it names a code, names the same one.
func (cmp Comparison) ruleErrorEnvelope(finding Finding, beforeBody, afterBody any) Finding {
	branch, isObject := afterBody.(map[string]any)
	if !isObject {
		return finding
	}
	code, hasCode := branch["code"].(string)
	_, hasType := branch["type"].(string)
	_, hasMessage := branch["message"].(string)
	_, hasRetryable := branch["retryable"].(bool)
	if !hasCode || !hasType || !hasMessage || !hasRetryable {
		return finding
	}
	if mainCode := mainErrorCode(beforeBody); mainCode != "" && mainCode != code {
		return finding
	}
	return cmp.ruled(finding.Kind, finding.Fields, map[string]bool{rulingErrorEnvelope: true})
}

// mainErrorCode reads the machine code from any of main's error dialects, or "" for a sentence.
func mainErrorCode(body any) string {
	object, isObject := body.(map[string]any)
	if !isObject {
		return ""
	}
	for _, key := range []string{"error", "frame"} {
		if nested, isNested := object[key].(map[string]any); isNested {
			code, _ := nested["code"].(string)
			return code
		}
	}
	if code, isCode := object["code"].(string); isCode {
		return code
	}
	if code, isCode := object["error"].(string); isCode && errorCodeSpelling.MatchString(code) {
		return code
	}
	return ""
}
