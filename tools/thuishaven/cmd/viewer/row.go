package viewer

import (
	"hash/fnv"

	"github.com/charmbracelet/x/ansi"

	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// A row's identity, so the reader's own state follows the line rather than the
// place it happened to be drawn. Expansion keyed by screen position looked
// right until the view scrolled: the opened row stayed open and a different
// line was inside it. Identity is per tab and only has to be stable while that
// tab is on screen.

// Row is one rendered body row and the identity that follows the line it
// renders.
type Row struct {
	// ID is stable for the life of the line: the push counter for a streamed
	// line, and the key of the thing it describes for a tab whose rows are
	// rebuilt from data on every poll.
	ID int64
	// Text is the painted row, without the gutter the viewer adds.
	Text string
	// Source is the child's own line, kept so an opened row can be shown as
	// what it is - a record with fields - rather than as the painted string
	// rewrapped as prose. Empty for a row that is not a log line.
	Source string
}

// Parts splits a painted log line into the part a person reads as the line and
// the structured fields hanging off the end of it. An opened row lists those
// fields one per row, because a wall of key=value wrapped as prose is the one
// shape in which nobody can find the key they came for.
//
// The split is by column, not by re-parsing the painted text: logfmt renders
// the time, lane and level columns to a fixed width and then the message, so
// everything past MessageColumn + the message is fields.
func (r Row) Parts() (head string, fields []string) {
	rec, ok := logfmt.Parse(r.Source)
	if !ok || len(rec.Fields) == 0 {
		return r.Text, nil
	}
	head = ansi.Cut(r.Text, 0, logfmt.MessageColumn+ansi.StringWidth(rec.Message))
	for _, field := range rec.Fields {
		fields = append(fields, sgrDim+field.Key+"="+sgrReset+field.Value)
	}
	return head, fields
}

// indexedRows identifies rows by their position in a fixed panel - the right
// answer where the list has a fixed length and a fixed order, so position IS
// identity (the metrics panel, the store meters).
func indexedRows(lines []string) []Row {
	out := make([]Row, 0, len(lines))
	for i, line := range lines {
		out = append(out, Row{ID: int64(i + 1), Text: line})
	}
	return out
}

// keyedRows identifies rows by a key of their own - an error's signature, a
// trace id, a job's name - so a row keeps its identity as the list is re-sorted
// and re-fetched underneath it.
func keyedRows(lines, keys []string) []Row {
	out := make([]Row, 0, len(lines))
	for i, line := range lines {
		key := ""
		if i < len(keys) {
			key = keys[i]
		}
		out = append(out, Row{ID: rowID(key), Text: line})
	}
	return out
}

// rowID hashes a key into a row identity. A collision would open the wrong row
// and nothing worse, and at the scale of one screen there will not be one.
func rowID(key string) int64 {
	if key == "" {
		return 0
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(key))
	return int64(h.Sum64() >> 1)
}

// textRows is for a body with no row identity to offer: a drill-in, an empty
// state, a header. Nothing in it is expandable on its own.
func textRows(lines []string) []Row {
	out := make([]Row, 0, len(lines))
	for _, line := range lines {
		out = append(out, Row{Text: line})
	}
	return out
}
