package redact

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Marker is the text a redacted secret is replaced with.
const Marker = "[redacted]"

// Redactor replaces secret values with "[redacted]" in a text.
type Redactor struct {
	forms      []string
	maxFormLen int
}

type span struct{ start, end int }

// New builds a Redactor for the secret values and the extra values. Secrets
// arrive as valid UTF-8 from JSON; both the value and its sanitized form
// (invalid bytes replaced) are matched, so raw and sanitized text redact.
// Each is matched raw and in the escaped forms a JSON writer produces.
func New(secrets map[string]string, extra ...string) *Redactor {
	values := make([]string, 0, len(extra)+len(secrets))
	values = append(values, extra...)
	values = append(values, slices.Collect(maps.Values(secrets))...)
	seen := map[string]struct{}{}
	for _, value := range values {
		if value == "" {
			continue
		}
		for _, v := range distinct(value, strings.ToValidUTF8(value, "\uFFFD")) {
			for _, form := range secretForms(v) {
				seen[form] = struct{}{}
			}
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
	return &Redactor{forms: append(forms, Marker), maxFormLen: max(maxLen, len(Marker))}
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
		out.WriteString(Marker)
		last = s.end
	}
	out.WriteString(text[last:])
	return out.String()
}

// MaxFormLen is the length of the longest form Redact can match: a secret
// that starts inside a window and is at most this long ends inside the
// window extended by it.
func (r *Redactor) MaxFormLen() int { return r.maxFormLen }

// SafeStart returns the smallest start at or after from that falls inside no
// secret and on a rune start, so raw[start:] holds whole secrets or none.
// Work on raw: Redact changes lengths, so redacted offsets do not map back.
func (r *Redactor) SafeStart(raw string, from int) int {
	start := min(max(from, 0), len(raw))
	spans := r.mergedSpans(raw)
	// Leaving a span can land mid-rune and a rune start can land in a span,
	// so the two moves repeat until neither changes the start.
	for {
		moved := alignForward(raw, endOfSpanContaining(spans, start))
		if moved == start {
			return start
		}
		start = moved
	}
}

// alignForward moves start to a rune start, giving up after UTFMax-1 bytes;
// what stays invalid is for strings.ToValidUTF8 to drop.
func alignForward(raw string, start int) int {
	for i := 0; i < utf8.UTFMax-1 && start < len(raw) && !utf8.RuneStart(raw[start]); i++ {
		start++
	}
	return start
}

// endOfSpanContaining moves pos to the end of the span that strictly contains it.
func endOfSpanContaining(spans []span, pos int) int {
	for _, s := range spans {
		if s.start < pos && pos < s.end {
			return s.end
		}
	}
	return pos
}

// TrimPartialTail removes, once, the longest suffix of raw that is a proper
// prefix of a secret form: a secret cut off at the end is not matched whole.
// A suffix inside a whole match stays (it is redacted); one that cuts a match
// in two takes the match with it. An ordinary tail that looks like a prefix
// goes too: a leak is worse than losing up to MaxFormLen-1 bytes.
func (r *Redactor) TrimPartialTail(raw string) string {
	k := r.partialTailLen(raw)
	if k == 0 {
		return raw
	}
	cut := len(raw) - k
	for _, s := range r.mergedSpans(raw) {
		if s.start <= cut && s.end >= len(raw) {
			return raw
		}
		if s.start < cut && cut < s.end {
			cut = s.start
		}
	}
	return raw[:cut]
}

// partialTailLen is the longest proper prefix of any form that ends raw,
// found with a KMP scan of the last len(form)-1 bytes: O(len(form)) per form.
func (r *Redactor) partialTailLen(raw string) int {
	longest := 0
	for _, form := range r.forms {
		if form == Marker {
			continue
		}
		window := raw[max(0, len(raw)-(len(form)-1)):]
		longest = max(longest, prefixSuffixLen(form, window))
	}
	return longest
}

// failureTable is the KMP table for the first n bytes of form: for each
// prefix, the length of its longest proper prefix that is also its suffix.
func failureTable(form string, n int) []int {
	fail := make([]int, n)
	for i, k := 1, 0; i < n; i++ {
		for k > 0 && form[i] != form[k] {
			k = fail[k-1]
		}
		if form[i] == form[k] {
			k++
		}
		fail[i] = k
	}
	return fail
}

// prefixSuffixLen is the length of the longest prefix of form that ends
// window; window must be shorter than form. The table needs only as many
// entries as the window has bytes (at most len(form)-1), so this saves work
// only when the text is shorter than the secret.
func prefixSuffixLen(form, window string) int {
	fail := failureTable(form, len(window))
	k := 0
	for i := 0; i < len(window); i++ {
		for k > 0 && window[i] != form[k] {
			k = fail[k-1]
		}
		if window[i] == form[k] {
			k++
		}
	}
	return k
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

// distinct returns value, then sanitized when it differs.
func distinct(value, sanitized string) []string {
	if value == sanitized {
		return []string{value}
	}
	return []string{value, sanitized}
}
