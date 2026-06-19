package openai

import (
	"bytes"
	"io"
	"sync"
	"time"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// maxCaptureBytes bounds how much of a response body we buffer for attribute
// extraction. A body larger than this is still passed through to the consumer
// byte-for-byte, but is not parsed — so a pathological payload can never grow
// the tracer's memory without limit. Real LLM responses are far smaller.
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
	// Don't retain pathologically large buffers in the pool.
	if buf == nil || buf.Cap() > maxCaptureBytes {
		return
	}
	capturePool.Put(buf)
}

// boundedBuffer accumulates up to maxCaptureBytes, then stops and marks itself
// truncated. It never reallocates beyond the cap.
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

// capturingBody wraps a non-streaming response body. It copies bytes into a
// bounded buffer as the consumer reads them — never pre-reading or blocking the
// consumer — and invokes onComplete exactly once when the body reaches EOF or is
// closed, handing over the captured bytes (and whether they were truncated).
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
	if err != nil { // io.EOF or a read error — the capture is as complete as it gets.
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

// streamingCaptureBody passes an SSE stream through to the consumer
// byte-for-byte while incrementally parsing `data:` payloads into the
// accumulator. The consumer's own reads drive parsing — there is no extra
// goroutine or io.Pipe hop, and the response bytes are never altered. When the
// stream reaches EOF or is closed it records the request attributes, finishes
// the accumulator and ends the span, exactly once.
type streamingCaptureBody struct {
	body         io.ReadCloser
	span         *langwatch.Span
	acc          streamAccumulator
	capture      langwatch.DataCaptureMode
	recordReq    func()
	start        time.Time
	ttftRecorded bool   // gen_ai.response.time_to_first_chunk has been set
	line         []byte // an in-progress SSE line carried across Read calls
	terminated   bool   // a [DONE]/terminal sentinel was seen
	once         sync.Once
}

func newStreamingCaptureBody(
	body io.ReadCloser,
	span *langwatch.Span,
	acc streamAccumulator,
	capture langwatch.DataCaptureMode,
	recordReq func(),
	start time.Time,
) *streamingCaptureBody {
	return &streamingCaptureBody{body: body, span: span, acc: acc, capture: capture, recordReq: recordReq, start: start}
}

func (s *streamingCaptureBody) Read(p []byte) (int, error) {
	n, err := s.body.Read(p)
	if n > 0 {
		s.scan(p[:n]) // inspect a copy; p is returned to the consumer unchanged
	}
	// Finish as soon as the terminal marker is seen (a client may stop reading at
	// [DONE] without ever hitting EOF or calling Close), or when the body ends.
	if s.terminated || err != nil {
		s.finish()
	}
	return n, err
}

func (s *streamingCaptureBody) Close() error {
	s.finish()
	return s.body.Close()
}

// scan splits the chunk on newlines, feeding each complete line to handleLine and
// carrying any trailing partial line into s.line for the next Read.
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

// appendLine grows the in-progress line, capping it so a pathological unbroken
// line can't grow memory without limit.
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
	if !bytes.HasPrefix(line, sseDataPrefix) {
		return
	}
	payload := bytes.TrimSpace(line[len(sseDataPrefix):])
	if len(payload) == 0 {
		return
	}
	if bytes.Equal(payload, sseDone) {
		s.terminated = true
		return
	}
	// The first genuine payload marks time-to-first-chunk (TTFT): the latency
	// from request start to the first streamed chunk, in seconds. Recorded once.
	s.recordTTFT()
	if s.acc.isTerminal(string(payload)) {
		s.terminated = true
		return
	}
	s.acc.consume(string(payload))
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
		if len(s.line) > 0 { // flush a trailing line with no final newline
			s.handleLine(s.line)
			s.line = nil
		}
		if s.recordReq != nil {
			s.recordReq()
		}
		s.acc.finish(s.span, s.capture)
		s.span.End()
	})
}
