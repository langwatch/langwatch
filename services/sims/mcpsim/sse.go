package mcpsim

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// maxSSEEvent bounds one event-stream line and one event's data lines together,
// so a stream that never ends a line or an event cannot grow the sim's memory.
const maxSSEEvent = 1 << 20

// readSSEAnswer reads an SSE body until the message answering id arrives.
func readSSEAnswer(r io.Reader, id any) (*rpcMessage, error) {
	want, _ := json.Marshal(id)
	var found *rpcMessage
	err := readSSE(r, func(ev sseEvent) bool {
		var m rpcMessage
		if ev.isComment || json.Unmarshal([]byte(ev.data), &m) != nil || !bytes.Equal(bytes.TrimSpace(m.ID), want) {
			return true
		}
		found = &m
		return false
	})
	if found != nil {
		return found, nil
	}
	if err == nil {
		err = errors.New("the event stream ended before the answer arrived")
	}
	return nil, err
}

type sseEvent struct {
	event, data string
	isComment   bool
}

// sseParser assembles events from lines.
type sseParser struct {
	ev   sseEvent
	data []string
}

// line takes one line and answers an event (or comment) when one is complete.
func (p *sseParser) line(line string) (sseEvent, bool) {
	switch {
	case line == "":
		if len(p.data) == 0 && p.ev.event == "" {
			return sseEvent{}, false
		}
		ev := p.ev
		ev.data = strings.Join(p.data, "\n")
		p.ev, p.data = sseEvent{}, nil
		return ev, true
	case strings.HasPrefix(line, ":"):
		return sseEvent{isComment: true, data: strings.TrimSpace(line[1:])}, true
	case strings.HasPrefix(line, "data:"):
		p.data = append(p.data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
	case strings.HasPrefix(line, "event:"):
		p.ev.event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
	}
	return sseEvent{}, false
}

// readSSE calls each with every event (and comment) until it answers false or the stream ends.
func readSSE(r io.Reader, each func(sseEvent) bool) error {
	sr := &sseReader{br: bufio.NewReaderSize(r, 64<<10)}
	for {
		ev, ok, err := sr.next()
		if ok && !each(ev) {
			return nil
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// sseReader reads lines into events, counting the bytes of the event still open: its data and
// event lines. A comment never closes the event, and a blank line ends or discards it.
type sseReader struct {
	br      *bufio.Reader
	p       sseParser
	pending int
}

// next reads one line and answers the event it completed, if it completed one.
func (sr *sseReader) next() (sseEvent, bool, error) {
	line, err := readLine(sr.br, maxSSEEvent-sr.pending)
	if errors.Is(err, errLineTooLong) {
		return sseEvent{}, false, fmt.Errorf("an event-stream event is longer than %d bytes", maxSSEEvent)
	}
	trimmed := strings.TrimRight(line, "\r\n")
	switch {
	case trimmed == "":
		sr.pending = 0
	case !strings.HasPrefix(trimmed, ":"):
		sr.pending += len(line)
	}
	ev, ok := sr.p.line(trimmed)
	return ev, ok, err
}

var errLineTooLong = errors.New("the line is too long")

// readLine reads up to and including '\n', refusing a line longer than limit bytes.
func readLine(br *bufio.Reader, limit int) (string, error) {
	var b []byte
	for {
		chunk, err := br.ReadSlice('\n')
		if len(b)+len(chunk) > limit {
			return "", errLineTooLong
		}
		b = append(b, chunk...)
		if !errors.Is(err, bufio.ErrBufferFull) {
			return string(b), err
		}
	}
}
