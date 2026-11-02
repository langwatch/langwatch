package redact

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf16"
)

const redactedMarker = "[redacted]"

// Redactor replaces secret values with "[redacted]" in one pass over a text.
// Building one sorts the forms and compiles a replacer, so reuse it across
// the texts of one run.
type Redactor struct {
	replacer   *strings.Replacer
	forms      []string
	maxFormLen int
}

// New builds a Redactor for the secret values and the extra values. Each
// value is matched raw and in the escaped forms a JSON writer produces.
// Longest forms go first so a secret that contains another is not left
// half-visible, and one pass keeps a short secret from matching in a marker.
func New(secrets map[string]string, extra ...string) *Redactor {
	values := make([]string, 0, len(extra)+len(secrets))
	values = append(values, extra...)
	values = append(values, mapValues(secrets)...)
	seen := map[string]struct{}{}
	for _, value := range values {
		if value == "" {
			continue
		}
		for _, form := range secretForms(value) {
			seen[form] = struct{}{}
		}
	}
	if len(seen) == 0 {
		return &Redactor{}
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
	// The marker pair goes first: NewReplacer tries pairs in argument order,
	// so an existing marker is consumed whole and its letters never match a
	// short secret.
	pairs := make([]string, 0, 2*len(forms)+2)
	pairs = append(pairs, redactedMarker, redactedMarker)
	for _, form := range forms {
		pairs = append(pairs, form, redactedMarker)
	}
	return &Redactor{replacer: strings.NewReplacer(pairs...), forms: forms, maxFormLen: len(forms[0])}
}

// Redact replaces every secret form in text with "[redacted]".
func (r *Redactor) Redact(text string) string {
	if r.replacer == nil || text == "" {
		return text
	}
	return r.replacer.Replace(text)
}

// MaxFormLen is the length of the longest form Redact can match: a secret
// that starts inside a window and is at most this long ends inside the
// window extended by it.
func (r *Redactor) MaxFormLen() int { return r.maxFormLen }

// CutBefore returns the largest cut point at or below limit that falls inside
// no secret form in raw, so raw[:cut] holds whole secrets or none. It works on
// the raw text: Redact changes lengths, so an offset taken from redacted text
// does not point at the same place in raw.
func (r *Redactor) CutBefore(raw string, limit int) int {
	cut := min(limit, len(raw))
	for moved := true; moved; {
		moved = false
		for _, form := range r.forms {
			for from := 0; ; {
				i := strings.Index(raw[from:], form)
				if i < 0 {
					break
				}
				start := from + i
				if start >= cut {
					break
				}
				if start+len(form) > cut {
					cut, moved = start, true
				}
				from = start + 1
			}
		}
	}
	return cut
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
	marshaled := bytes.TrimSpace(buf.Bytes())
	escaped := string(marshaled[1 : len(marshaled)-1])
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
