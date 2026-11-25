package a2aproxy

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"net/http"
	"strings"
)

// errEventTooLarge is an SSE event, or one of its lines, over maxEventBytes.
var errEventTooLarge = errors.New("an SSE event is over the size limit")

// stream forwards an SSE reply event by event. An event that fails the scan,
// an event over the size limit and a broken upstream stream each end the
// stream with one error event, so the caller never sees a silent cut.
func (h *Handler) stream(c *call, resp *http.Response) {
	copyHeader(c.w.Header(), resp.Header)
	c.w.WriteHeader(resp.StatusCode)
	flusher, _ := c.w.(http.Flusher)
	write := func(event []byte) {
		_, _ = c.w.Write(event)
		if flusher != nil {
			flusher.Flush()
		}
	}
	var seen streamText
	err := readEvents(resp.Body, func(event []byte) bool {
		event = sseFields(event)
		if len(event) == 0 {
			return true
		}
		setResultAttrs(c.span, eventData(event))
		if r := h.checkEvent(c, event, &seen); r != nil {
			c.markRefused(*r)
			event = c.errorEvent(*r)
		}
		write(event)
		return c.refusedReason == ""
	})
	if err == nil || c.ctx.Err() != nil {
		return
	}
	r := refuseUpstream.withMessage("the A2A agent stream broke off")
	if errors.Is(err, errEventTooLarge) {
		r = refuseReplyTooLarge.withMessage("an event from the A2A agent is over the size limit")
	}
	h.recordCause(c, r.reason, err)
	c.markRefused(r)
	write(c.errorEvent(r))
}

// streamTailBytes is how much earlier text of the same artifact each event
// is scanned with, so a phrase split across events is seen whole.
const streamTailBytes = 4 << 10

// maxStreamTails bounds how many artifacts a stream keeps a tail for; past
// it, the artifact written longest ago is dropped.
const maxStreamTails = 64

type streamTail struct{ id, text string }

// streamText keeps the end of each artifact's streamed text-part text, the
// most recently written last. Names, other strings and SSE field values never
// join it, so nothing lands between the halves of a split phrase.
type streamText struct{ tails []streamTail }

func (s *streamText) tail(id string) string {
	for _, t := range s.tails {
		if t.id == id {
			return t.text
		}
	}
	return ""
}

// drop forgets an artifact's tail: its next text replaces what came before.
func (s *streamText) drop(id string) {
	for i, t := range s.tails {
		if t.id == id {
			s.tails = append(s.tails[:i], s.tails[i+1:]...)
			return
		}
	}
}

func (s *streamText) add(id, text string) {
	joined := text
	for i, t := range s.tails {
		if t.id == id {
			joined = t.text + text
			s.tails = append(s.tails[:i], s.tails[i+1:]...)
			break
		}
	}
	if len(joined) > streamTailBytes {
		// A copy, so the tail no longer holds the whole event's text in memory.
		joined = strings.Clone(joined[len(joined)-streamTailBytes:])
	}
	s.tails = append(s.tails, streamTail{id: id, text: joined})
	if len(s.tails) > maxStreamTails {
		s.tails = s.tails[1:]
	}
}

// checkEvent scans every string of one event and its SSE field values each
// on its own, plus each artifact's text-part text joined to that artifact's
// text streamed before it, with the key's response and stream_chunk guardrails.
func (h *Handler) checkEvent(c *call, event []byte, seen *streamText) *refusal {
	response := h.cfg.Scanner.Applies(c.bundle, DirectionResponse)
	chunk := h.cfg.Scanner.Applies(c.bundle, DirectionStreamChunk)
	if !response && !chunk {
		return nil
	}
	p := collectStreamTexts(eventData(event))
	if !p.parsed {
		return &refuseReplyUnscannable
	}
	p.texts = append(p.texts, fieldValues(event)...)
	for _, part := range p.parts {
		if !part.appends {
			seen.drop(part.id)
		}
		if prev := seen.tail(part.id); prev != "" || part.split {
			p.texts = append(p.texts, prev+part.text)
		}
		if part.text != "" {
			seen.add(part.id, part.text)
		}
	}
	if response {
		if r := h.checkTexts(c, DirectionResponse, p.texts); r != nil {
			return r
		}
	}
	if chunk {
		return h.checkTexts(c, DirectionStreamChunk, p.texts)
	}
	return nil
}

func (c *call) errorEvent(r refusal) []byte {
	return []byte("data: " + string(c.errorBody(r)) + "\n\n")
}

// readEvents splits an SSE body into events, each with its trailing blank
// line, and stops when fn returns false. An event, counted with its line
// breaks, may hold at most maxEventBytes. One leading UTF-8 BOM is dropped,
// as SSE decoding does.
func readEvents(r io.Reader, fn func(event []byte) bool) error {
	lr := newLineReader(r)
	var event bytes.Buffer
	for {
		blank, err := lr.readLine(&event)
		if err != nil {
			return finishEvents(err)
		}
		if blank && !emitEvent(&event, fn) {
			return nil
		}
	}
}

// newLineReader wraps r and drops one leading UTF-8 BOM.
func newLineReader(r io.Reader) *lineReader {
	lr := &lineReader{br: bufio.NewReaderSize(r, 64<<10)}
	if head, err := lr.br.Peek(len(utf8BOM)); err == nil && bytes.Equal(head, utf8BOM) {
		_, _ = lr.br.Discard(len(utf8BOM))
	}
	return lr
}

// emitEvent hands a finished event to fn and resets the buffer. An empty
// buffer is no event. It reports whether reading should go on.
func emitEvent(event *bytes.Buffer, fn func(event []byte) bool) bool {
	if event.Len() == 0 {
		return true
	}
	event.WriteByte('\n')
	keepGoing := fn(append([]byte(nil), event.Bytes()...))
	event.Reset()
	return keepGoing
}

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// finishEvents ends the read. At the end of the body an event without its
// blank line is dropped, as SSE decoding does; any other error is returned.
func finishEvents(err error) error {
	if errors.Is(err, io.EOF) {
		return nil
	}
	return err
}

// lineReader reads SSE lines ended by CR, LF or CRLF. After a CR it skips
// one LF at the next read instead of waiting for it, so a bare CR at the end
// of a burst does not hold the line back.
type lineReader struct {
	br     *bufio.Reader
	skipLF bool
}

// readLine appends one line and an LF to event and reports whether the line
// was blank, which ends an event. It refuses to grow event past maxEventBytes.
func (lr *lineReader) readLine(event *bytes.Buffer) (blank bool, err error) {
	lineLen := 0
	for {
		b, err := lr.next()
		if err != nil {
			return false, err
		}
		switch {
		case b == '\r' || b == '\n':
			return endLine(event, lineLen), nil
		case event.Len()+2 > maxEventBytes:
			return false, errEventTooLarge
		}
		event.WriteByte(b)
		lineLen++
	}
}

// next reads one byte, skipping the LF of a CRLF whose CR ended the last line.
func (lr *lineReader) next() (byte, error) {
	b, err := lr.br.ReadByte()
	if err == nil && lr.skipLF && b == '\n' {
		b, err = lr.br.ReadByte()
	}
	lr.skipLF = err == nil && b == '\r'
	return b, err
}

// endLine closes a line in event and reports whether it was blank.
func endLine(event *bytes.Buffer, lineLen int) bool {
	if lineLen == 0 {
		return true
	}
	event.WriteByte('\n')
	return false
}

// eventData joins the data lines of one SSE event.
func eventData(event []byte) []byte {
	var data bytes.Buffer
	for _, line := range bytes.Split(event, []byte("\n")) {
		if v, ok := bytes.CutPrefix(line, []byte("data:")); ok {
			data.Write(bytes.TrimPrefix(v, []byte(" ")))
			data.WriteByte('\n')
		}
	}
	return data.Bytes()
}

// sseFields keeps the data, event, id and retry lines of one event and drops
// comments and any other line, so nothing reaches the caller unscanned. An
// event left with no line is empty.
func sseFields(event []byte) []byte {
	var out bytes.Buffer
	for _, line := range bytes.Split(event, []byte("\n")) {
		name, _, _ := bytes.Cut(line, []byte(":"))
		switch string(name) {
		case "data", "event", "id", "retry":
			out.Write(line)
			out.WriteByte('\n')
		}
	}
	if out.Len() == 0 {
		return nil
	}
	out.WriteByte('\n')
	return out.Bytes()
}

// fieldValues returns the values of an event's event, id and retry lines.
func fieldValues(event []byte) []string {
	var out []string
	for _, line := range bytes.Split(event, []byte("\n")) {
		name, v, _ := bytes.Cut(line, []byte(":"))
		field := string(name)
		scanned := field == "event" || field == "id" || field == "retry"
		if scanned && len(bytes.TrimSpace(v)) > 0 {
			out = append(out, string(bytes.TrimSpace(v)))
		}
	}
	return out
}
