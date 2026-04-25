package gatewayclient

import (
	"bufio"
	"bytes"
	"context"
	"net/http"
)

// sseIterator reads an SSE response one event at a time. An event is a
// sequence of `data:` (and `event:` / `id:`) lines terminated by a blank
// line. The chunk we surface to callers is the raw bytes of the event
// (including the blank-line terminator) so a proxy can re-emit them
// byte-equivalent without parsing.
type sseIterator struct {
	resp    *http.Response
	reader  *bufio.Reader
	chunk   []byte
	err     error
	closed  bool
}

func newSSEIterator(resp *http.Response) *sseIterator {
	return &sseIterator{
		resp:   resp,
		reader: bufio.NewReaderSize(resp.Body, 64*1024),
	}
}

// Next reads one SSE event from the response. Returns false at EOF or on
// context cancellation. Errors are surfaced via Err() — Next does not
// return them directly because the StreamIterator interface signals
// completion with a single bool.
func (s *sseIterator) Next(ctx context.Context) bool {
	if s.err != nil || s.closed {
		return false
	}
	if err := ctx.Err(); err != nil {
		s.err = err
		return false
	}

	var event bytes.Buffer
	for {
		line, err := s.reader.ReadBytes('\n')
		if len(line) > 0 {
			event.Write(line)
			// A blank line (just \n or \r\n) terminates the event.
			if isBlankLine(line) {
				if event.Len() > len(line) {
					s.chunk = append(s.chunk[:0], event.Bytes()...)
					return true
				}
				event.Reset()
				continue
			}
		}
		if err != nil {
			if event.Len() > 0 {
				// Final partial event with no terminator — emit as-is.
				s.chunk = append(s.chunk[:0], event.Bytes()...)
				return true
			}
			if err.Error() != "EOF" {
				s.err = err
			}
			return false
		}
	}
}

// Chunk returns the bytes of the most recent event. Valid only until the
// next call to Next() — the buffer is reused.
func (s *sseIterator) Chunk() []byte {
	return s.chunk
}

// Err returns the first non-EOF error encountered, or nil.
func (s *sseIterator) Err() error {
	return s.err
}

// Close releases the underlying connection. Safe to call multiple times.
func (s *sseIterator) Close() error {
	if s.closed {
		return nil
	}
	s.closed = true
	return s.resp.Body.Close()
}

func isBlankLine(b []byte) bool {
	if len(b) == 1 && b[0] == '\n' {
		return true
	}
	if len(b) == 2 && b[0] == '\r' && b[1] == '\n' {
		return true
	}
	return false
}
