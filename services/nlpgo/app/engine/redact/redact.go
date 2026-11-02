package redact

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const redactedMarker = "[redacted]"

// Redactor replaces secret values with "[redacted]" in a text.
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
	forms := make([]string, 0, len(seen)+1)
	maxLen := 0
	for form := range seen {
		forms = append(forms, form)
		maxLen = max(maxLen, len(form))
	}
	// The marker is matched like a form so a short secret never splits it.
	return &Redactor{forms: append(forms, redactedMarker), maxFormLen: maxLen}
}

// Redact replaces every secret form in text with "[redacted]". Forms that
// overlap or touch are replaced as one span, so no part of either is left
// showing, and an existing marker is kept whole.
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
	if len(r.forms) == 0 {
		return alignToRune(raw, cut)
	}
	spans := r.mergedSpans(raw)
	// Leaving a span can land mid-rune and stepping back can land in the
	// span again, so the two moves repeat until neither changes the cut.
	for {
		moved := alignToRune(raw, startOutsideSpans(spans, cut))
		if moved == cut {
			return cut
		}
		cut = moved
	}
}

func alignToRune(raw string, cut int) int {
	for cut > 0 && cut < len(raw) && !utf8.RuneStart(raw[cut]) {
		cut--
	}
	return cut
}

// startOutsideSpans moves cut to the start of the span that strictly contains it.
func startOutsideSpans(spans []span, cut int) int {
	for _, s := range spans {
		if s.start < cut && cut < s.end {
			return s.start
		}
	}
	return cut
}

// mergedSpans is the sorted, disjoint spans every form (and the marker)
// occupies in text. The search is O(forms * len(text)) and, for a form that
// overlaps itself, up to its length times that; memory is one entry per run,
// never one per occurrence.
func (r *Redactor) mergedSpans(text string) []span {
	var runs []span
	for _, form := range r.forms {
		runs = append(runs, formRuns(text, form)...)
	}
	return mergeRuns(runs)
}

// formRuns finds the occurrences of one form, joining those that overlap or
// touch into one run as it goes, so a text of one repeated byte is one run.
func formRuns(text, form string) []span {
	var runs []span
	for from := 0; from < len(text); {
		i := strings.Index(text[from:], form)
		if i < 0 {
			break
		}
		start := from + i
		if n := len(runs); n > 0 && start <= runs[n-1].end {
			runs[n-1].end = max(runs[n-1].end, start+len(form))
		} else {
			runs = append(runs, span{start, start + len(form)})
		}
		from = start + 1
	}
	return runs
}

func mergeRuns(runs []span) []span {
	if len(runs) == 0 {
		return nil
	}
	slices.SortFunc(runs, func(a, b span) int { return cmp.Compare(a.start, b.start) })
	merged := runs[:1]
	for _, s := range runs[1:] {
		if last := &merged[len(merged)-1]; s.start <= last.end {
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
