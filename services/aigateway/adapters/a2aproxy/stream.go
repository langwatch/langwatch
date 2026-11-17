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
// breaks, may hold at most maxEventBytes.
func readEvents(r io.Reader, fn func(event []byte) bool) error {
	br := bufio.NewReaderSize(r, 64<<10)
	var event bytes.Buffer
	for {
		blank, err := readLine(br, &event)
		if err != nil {
			return finishEvents(err, &event, fn)
		}
		if blank && event.Len() > 0 {
			event.WriteByte('\n')
			if !fn(append([]byte(nil), event.Bytes()...)) {
				return nil
			}
			event.Reset()
		}
	}
}

// finishEvents hands over the last event of a body that ended without a
// blank line. Any error other than the end of the body is returned.
func finishEvents(err error, event *bytes.Buffer, fn func(event []byte) bool) error {
	if !errors.Is(err, io.EOF) {
		return err
	}
	if event.Len() > 0 {
		event.WriteByte('\n')
		fn(event.Bytes())
	}
	return nil
}

// readLine appends one line and its line break to event and reports whether
// the line was blank, which ends an event. It refuses to grow event past
// maxEventBytes.
func readLine(br *bufio.Reader, event *bytes.Buffer) (blank bool, err error) {
	lineLen := 0
	for {
		chunk, isPrefix, err := br.ReadLine()
		if err != nil {
			return false, err
		}
		if event.Len()+len(chunk)+2 > maxEventBytes {
			return false, errEventTooLarge
		}
		event.Write(chunk)
		lineLen += len(chunk)
		if isPrefix {
			continue
		}
		if lineLen == 0 {
			return true, nil
		}
		event.WriteByte('\n')
		return false, nil
	}
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
