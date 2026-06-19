package otelhttp

import (
	"bytes"
	"io"
	"sync"
	"time"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// maxCaptureBytes bounds how much of a body we buffer for attribute extraction.
// A larger body is still passed through byte-for-byte, but is not parsed — so a
// pathological payload can never grow the tracer's memory without limit.
const maxCaptureBytes = 5 << 20 // 5 MiB

// SSE framing tokens, shared to avoid per-line allocations.
var (
	sseDataPrefix = []byte("data:")
	sseDone       = []byte("[DONE]")
)

// capturePool recycles capture buffers to keep the steady-state allocation cost
// of tracing near zero under load.
var capturePool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func getCaptureBuffer() *bytes.Buffer {
	buf := capturePool.Get().(*bytes.Buffer)
	buf.Reset()
	return buf
}

func putCaptureBuffer(buf *bytes.Buffer) {
	if buf == nil || buf.Cap() > maxCaptureBytes {
		return
	}
	capturePool.Put(buf)
}

// boundedBuffer accumulates up to maxCaptureBytes, then stops and marks truncated.
type boundedBuffer struct {
	buf       *bytes.Buffer
	truncated bool
}

func (b *boundedBuffer) write(p []byte) {
	if b.truncated {
		return
	}
	room := maxCaptureBytes - b.buf.Len()
	if room <= 0 {
		b.truncated = true
		return
	}
	if len(p) > room {
		b.buf.Write(p[:room])
		b.truncated = true
		return
	}
	b.buf.Write(p)
}

// capturingBody wraps a non-streaming response body, copying bytes into a
// bounded buffer as the consumer reads them (never pre-reading or blocking the
// consumer) and invoking onComplete exactly once at EOF or Close.
type capturingBody struct {
	body       io.ReadCloser
	cap        boundedBuffer
	once       sync.Once
	onComplete func(captured []byte, truncated bool)
}

func newCapturingBody(body io.ReadCloser, onComplete func(captured []byte, truncated bool)) *capturingBody {
	return &capturingBody{
		body:       body,
		cap:        boundedBuffer{buf: getCaptureBuffer()},
		onComplete: onComplete,
	}
}

func (c *capturingBody) Read(p []byte) (int, error) {
	n, err := c.body.Read(p)
	if n > 0 {
		c.cap.write(p[:n])
	}
	if err != nil {
		c.complete()
	}
	return n, err
}

func (c *capturingBody) Close() error {
	c.complete()
	return c.body.Close()
}

func (c *capturingBody) complete() {
	c.once.Do(func() {
		c.onComplete(c.cap.buf.Bytes(), c.cap.truncated)
		putCaptureBuffer(c.cap.buf)
	})
}

// streamingCaptureBody passes an SSE stream through to the consumer byte-for-byte
// while incrementally parsing `data:` payloads into the accumulator. The
// consumer's own reads drive parsing — no extra goroutine or io.Pipe — and the
// bytes are never altered. It records request attributes, finishes the
// accumulator and ends the span exactly once, as soon as the terminal marker is
// seen or the body ends.
type streamingCaptureBody struct {
	body         io.ReadCloser
	span         *langwatch.Span
	acc          StreamAccumulator
	capture      langwatch.DataCaptureMode
	recordReq    func()
	framing      StreamFraming
	start        time.Time
	ttftRecorded bool
	line         []byte
	terminated   bool
	once         sync.Once
}

func newStreamingCaptureBody(
	body io.ReadCloser,
	span *langwatch.Span,
	acc StreamAccumulator,
	capture langwatch.DataCaptureMode,
	recordReq func(),
	framing StreamFraming,
	start time.Time,
) *streamingCaptureBody {
	return &streamingCaptureBody{body: body, span: span, acc: acc, capture: capture, recordReq: recordReq, framing: framing, start: start}
}

func (s *streamingCaptureBody) Read(p []byte) (int, error) {
	n, err := s.body.Read(p)
	if n > 0 {
		s.scan(p[:n])
	}
	if s.terminated || err != nil {
		s.finish()
	}
	return n, err
}

func (s *streamingCaptureBody) Close() error {
	s.finish()
	return s.body.Close()
}

func (s *streamingCaptureBody) scan(chunk []byte) {
	if s.terminated {
		return
	}
	for len(chunk) > 0 {
		i := bytes.IndexByte(chunk, '\n')
		if i < 0 {
			s.appendLine(chunk)
			return
		}
		s.appendLine(chunk[:i])
		s.handleLine(s.line)
		s.line = s.line[:0]
		chunk = chunk[i+1:]
		if s.terminated {
			return
		}
	}
}

func (s *streamingCaptureBody) appendLine(b []byte) {
	if len(s.line) >= maxCaptureBytes {
		return
	}
	if room := maxCaptureBytes - len(s.line); len(b) > room {
		b = b[:room]
	}
	s.line = append(s.line, b...)
}

func (s *streamingCaptureBody) handleLine(line []byte) {
	var payload []byte
	if s.framing == FramingNDJSON {
		// Each line is itself the JSON payload; ignore blank/keep-alive lines.
		payload = bytes.TrimSpace(line)
		if len(payload) == 0 || payload[0] != '{' {
			return
		}
	} else {
		// SSE: only `data:` lines carry payloads; `[DONE]` terminates the stream.
		if !bytes.HasPrefix(line, sseDataPrefix) {
			return
		}
		payload = bytes.TrimSpace(line[len(sseDataPrefix):])
		if len(payload) == 0 {
			return
		}
		if bytes.Equal(payload, sseDone) {
			s.terminated = true
			return
		}
	}
	// The first genuine payload marks time-to-first-chunk (TTFT): the latency
	// from request start to the first streamed chunk, in seconds. Recorded once.
	s.recordTTFT()
	if s.acc.IsTerminal(string(payload)) {
		s.terminated = true
		return
	}
	s.acc.Consume(string(payload))
}

// recordTTFT sets gen_ai.response.time_to_first_chunk the first time it is
// called, from the elapsed time since the request started.
func (s *streamingCaptureBody) recordTTFT() {
	if s.ttftRecorded {
		return
	}
	s.ttftRecorded = true
	s.span.SetGenAITimeToFirstChunk(time.Since(s.start).Seconds())
}

func (s *streamingCaptureBody) finish() {
	s.once.Do(func() {
		if len(s.line) > 0 {
			s.handleLine(s.line)
			s.line = nil
		}
		if s.recordReq != nil {
			s.recordReq()
		}
		s.acc.Finish(s.span, s.capture)
		s.span.End()
	})
}
