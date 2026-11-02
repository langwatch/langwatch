package codeblock

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf16"
)

const redactedMarker = "[redacted]"

// RedactSecrets replaces every secret value, and the extra values, with
// "[redacted]" in one pass over text. Each value is matched in its raw form
// and in the escaped forms a JSON writer produces. Longest forms go first so
// a secret that contains another is not left half-visible, and one pass keeps
// a short secret from matching inside an earlier marker.
func RedactSecrets(text string, secrets map[string]string, extra ...string) string {
	if text == "" {
		return text
	}
	seen := map[string]struct{}{}
	for _, value := range append(extra, mapValues(secrets)...) {
		if value == "" {
			continue
		}
		for _, form := range secretForms(value) {
			seen[form] = struct{}{}
		}
	}
	if len(seen) == 0 {
		return text
	}
	forms := make([]string, 0, len(seen))
	for form := range seen {
		forms = append(forms, form)
	}
	sort.Slice(forms, func(i, j int) bool {
		if len(forms[i]) != len(forms[j]) {
			return len(forms[i]) > len(forms[j])
		}
		return forms[i] < forms[j]
	})
	// The marker pair goes first: NewReplacer tries pairs in argument order, so an existing marker is consumed whole and its letters never match a short secret.
	pairs := make([]string, 0, 2*len(forms)+2)
	pairs = append(pairs, redactedMarker, redactedMarker)
	for _, form := range forms {
		pairs = append(pairs, form, redactedMarker)
	}
	return strings.NewReplacer(pairs...).Replace(text)
}

func mapValues(m map[string]string) []string {
	values := make([]string, 0, len(m))
	for _, v := range m {
		values = append(values, v)
	}
	return values
}

// secretForms is the raw value, Go's JSON escaping and Python's
// ensure_ascii escaping (non-ASCII and DEL as \uXXXX, surrogate pairs above the BMP).
func secretForms(value string) []string {
	forms := []string{value}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false) // match Python's json.dumps, which leaves <, > and & as they are
	if err := enc.Encode(value); err != nil {
		return forms
	}
	marshalled := bytes.TrimSpace(buf.Bytes())
	escaped := string(marshalled[1 : len(marshalled)-1])
	forms = append(forms, escaped)
	var ascii strings.Builder
	for _, r := range escaped {
		switch {
		case r < 0x7f:
			ascii.WriteRune(r)
		case r > 0xffff:
			hi, lo := utf16.EncodeRune(r)
			fmt.Fprintf(&ascii, "\\u%04x\\u%04x", hi, lo)
		default:
			fmt.Fprintf(&ascii, "\\u%04x", r)
		}
	}
	return append(forms, ascii.String())
}
