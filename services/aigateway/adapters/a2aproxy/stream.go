package a2aproxy

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"net/http"
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
	err := readEvents(resp.Body, func(event []byte) bool {
		data := eventData(event)
		setResultAttrs(c.span, data)
		if r := h.check(c, DirectionResponse, collectTexts(data)); r != nil {
			c.markRefused(*r)
			event = c.errorEvent(*r)
		}
		write(event)
		return c.refusedReason == ""
	})
	if err == nil || c.ctx.Err() != nil {
		return
	}
	c.span.RecordError(err)
	r := refuseUpstream.withMessage("the A2A agent stream broke off")
	if errors.Is(err, errEventTooLarge) {
		r = refuseReplyTooLarge.withMessage("an event from the A2A agent is over the size limit")
	}
	c.markRefused(r)
	write(c.errorEvent(r))
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
