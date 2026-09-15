package viewer

import (
	"encoding/json"
	"regexp"
	"strings"
)

// The grouping rule, alone and pure. An error that fires on every restart is
// one problem, not eleven, and a screen that lists it eleven times has buried
// the other two. The platform already computes an error signature at ingest;
// where a line carries one, that is the grouping key, because it is the same
// key Grafana groups by and two screens disagreeing about what "the same error"
// means is worse than either rule alone.

// signatureFields are the spellings the platform writes its error signature
// under. It is stamped at ingest, so a line that has one needs no rule at all.
type signatureFields struct {
	Signature   string `json:"errorSignature"`
	DottedError struct {
		Signature string `json:"signature"`
	} `json:"error"`
}

// digits collapses every run of digits, which is what makes two otherwise
// identical messages look distinct: ports, counts, durations, byte offsets.
var digits = regexp.MustCompile(`\d+`)

// identifiers collapses the id shapes that appear inside a message - ksuids and
// prefixed ids, uuids, and hex runs long enough to be a trace or span id.
var identifiers = regexp.MustCompile(`\b[0-9a-f]{8,}\b|\b[A-Za-z]+_[0-9A-Za-z]{8,}\b|\b[0-9A-Za-z]{20,}\b`)

// quoted collapses whatever a message interpolated in quotes, which is nearly
// always the one value that differed between two runs of the same failure.
var quoted = regexp.MustCompile(`"[^"]*"|'[^']*'`)

// Signature is the key two failures are the same failure under. A line
// carrying the platform's own signature is grouped by it; anything else is
// grouped by its message with the parts that vary between runs removed.
func Signature(text, message string) string {
	if stamped := stampedSignature(text); stamped != "" {
		return stamped
	}
	return NormalizeMessage(message)
}

// stampedSignature reads the platform's signature off a structured line.
func stampedSignature(text string) string {
	trimmed := strings.TrimSpace(text)
	if !strings.HasPrefix(trimmed, "{") {
		return ""
	}
	var fields signatureFields
	if json.Unmarshal([]byte(trimmed), &fields) != nil {
		return ""
	}
	if fields.Signature != "" {
		return fields.Signature
	}
	return fields.DottedError.Signature
}

// NormalizeMessage strips the varying parts out of a message, leaving what two
// occurrences of the same failure have in common.
func NormalizeMessage(message string) string {
	out := quoted.ReplaceAllString(message, `""`)
	out = identifiers.ReplaceAllString(out, "*")
	out = digits.ReplaceAllString(out, "*")
	return strings.Join(strings.Fields(out), " ")
}
