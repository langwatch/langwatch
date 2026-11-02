package redact

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const redactedMarker = "[redacted]"

// Redactor replaces secret values with "[redacted]" in a text.
// Building one sorts the forms; reuse it across the texts of one run.
type Redactor struct {
	forms      []string
	maxFormLen int
}

type span struct{ start, end int }

// New builds a Redactor for the secret values and the extra values. Each
// value is matched raw and in the escaped forms a JSON writer produces.
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
	sort.Strings(forms)
	maxLen := 0
	for _, form := range forms {
		maxLen = max(maxLen, len(form))
	}
	return &Redactor{forms: forms, maxFormLen: maxLen}
}

// Redact replaces every secret form in text with "[redacted]". Forms that
// overlap are replaced as one span, so no part of either is left showing, and
// an existing marker is kept whole so a short secret never matches inside it.
func (r *Redactor) Redact(text string) string {
	if len(r.forms) == 0 || text == "" {
		return text
	}
	spans := r.mergedSpans(text)
	if len(spans) == 0 {
		return text
	}
	var out strings.Builder
	out.Grow(len(text))
	last := 0
	for _, s := range spans {
		out.WriteString(text[last:s.start])
		out.WriteString(redactedMarker)
		last = s.end
	}
	out.WriteString(text[last:])
	return out.String()
}

// MaxFormLen is the length of the longest form Redact can match: a secret
// that starts inside a window and is at most this long ends inside the
// window extended by it.
func (r *Redactor) MaxFormLen() int { return r.maxFormLen }

// SafeCut returns the largest cut point at or below limit that falls inside
// no secret and on a rune boundary, so raw[:cut] holds whole secrets or none.
// It works on the raw text: Redact changes lengths, so an offset taken from
// redacted text does not point at the same place in raw.
func (r *Redactor) SafeCut(raw string, limit int) int {
	cut := min(limit, len(raw))
	if len(r.forms) > 0 {
		for _, s := range r.mergedSpans(raw) {
			if s.start < cut && cut < s.end {
				cut = s.start
				break
			}
		}
	}
	for cut > 0 && cut < len(raw) && !utf8.RuneStart(raw[cut]) {
		cut--
	}
	return cut
}

// mergedSpans finds every occurrence of every form (and of the marker),
// overlapping ones included, and merges the overlapping ones. Cost is
// O(len(text) * forms): each search resumes one byte past the last start.
func (r *Redactor) mergedSpans(text string) []span {
	var spans []span
	for _, form := range append([]string{redactedMarker}, r.forms...) {
		for from := 0; from < len(text); {
			i := strings.Index(text[from:], form)
			if i < 0 {
				break
			}
			start := from + i
			spans = append(spans, span{start, start + len(form)})
			from = start + 1
		}
	}
	if len(spans) == 0 {
		return nil
	}
	slices.SortFunc(spans, func(a, b span) int { return cmp.Or(cmp.Compare(a.start, b.start), cmp.Compare(b.end, a.end)) })
	merged := spans[:1]
	for _, s := range spans[1:] {
		if last := &merged[len(merged)-1]; s.start < last.end {
			last.end = max(last.end, s.end)
		} else {
			merged = append(merged, s)
		}
	}
	return merged
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
