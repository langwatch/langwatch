package openai

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// stubReadCloser is an io.ReadCloser over a string that records Close.
type stubReadCloser struct {
	r      *strings.Reader
	closed bool
}

func newStubBody(s string) *stubReadCloser           { return &stubReadCloser{r: strings.NewReader(s)} }
func (s *stubReadCloser) Read(p []byte) (int, error) { return s.r.Read(p) }
func (s *stubReadCloser) Close() error               { s.closed = true; return nil }

func TestCapturingBody(t *testing.T) {
	t.Run("it passes bytes through unchanged and captures them once at EOF", func(t *testing.T) {
		const payload = `{"object":"chat.completion","id":"x"}`
		var gotCaptured []byte
		var gotTruncated bool
		calls := 0

		src := newStubBody(payload)
		cb := newCapturingBody(src, func(captured []byte, truncated bool) {
			calls++
			gotCaptured = append([]byte(nil), captured...) // copy before the pooled buffer is recycled
			gotTruncated = truncated
		})

		read, err := io.ReadAll(cb)
		require.NoError(t, err)
		assert.Equal(t, payload, string(read), "consumer must receive the exact bytes")
		require.NoError(t, cb.Close())

		assert.Equal(t, 1, calls, "onComplete fires exactly once across EOF + Close")
		assert.Equal(t, payload, string(gotCaptured))
		assert.False(t, gotTruncated)
		assert.True(t, src.closed, "the underlying body is closed")
	})

	t.Run("it completes on Close even when the body was only partially read", func(t *testing.T) {
		calls := 0
		cb := newCapturingBody(newStubBody("abcdef"), func([]byte, bool) { calls++ })

		_, err := cb.Read(make([]byte, 3)) // partial read, no EOF
		require.NoError(t, err)
		assert.Equal(t, 0, calls)

		require.NoError(t, cb.Close())
		assert.Equal(t, 1, calls)
	})
}

func TestBoundedBuffer(t *testing.T) {
	t.Run("it truncates at the cap and ignores further writes", func(t *testing.T) {
		bb := boundedBuffer{buf: new(bytes.Buffer)}
		bb.write(make([]byte, maxCaptureBytes+1024))
		assert.True(t, bb.truncated)
		assert.Equal(t, maxCaptureBytes, bb.buf.Len())

		bb.write([]byte("more"))
		assert.Equal(t, maxCaptureBytes, bb.buf.Len(), "writes after truncation are dropped")
	})
}

// recordingAccumulator captures what a streamAccumulator was fed.
type recordingAccumulator struct {
	consumed []string
	finished int
}

func (r *recordingAccumulator) consume(s string)         { r.consumed = append(r.consumed, s) }
func (r *recordingAccumulator) isTerminal(s string) bool { return s == "[DONE]" }
func (r *recordingAccumulator) finish(*langwatch.Span, langwatch.DataCaptureMode) {
	r.finished++
}

func newCaptureTestSpan(t *testing.T) (*langwatch.Span, *tracetest.InMemoryExporter) {
	t.Helper()
	exp := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exp)))
	_, span := langwatch.TracerFromProvider(provider, "test").Start(context.Background(), "op")
	return span, exp
}

// spanAttr looks up a single attribute on an exported span.
func spanAttr(span tracetest.SpanStub, key attribute.Key) (attribute.Value, bool) {
	for _, kv := range span.Attributes {
		if kv.Key == key {
			return kv.Value, true
		}
	}
	return attribute.Value{}, false
}

func TestStreamingCaptureBody(t *testing.T) {
	t.Run("it passes the stream through byte-exact and feeds only data payloads", func(t *testing.T) {
		const stream = "data: {\"a\":1}\n\ndata: {\"b\":2}\n\ndata: [DONE]\n\n"
		span, exp := newCaptureTestSpan(t)
		acc := &recordingAccumulator{}
		reqCalls := 0

		scb := newStreamingCaptureBody(newStubBody(stream), span, acc, langwatch.DataCaptureAll, func() { reqCalls++ }, time.Now())

		read, err := io.ReadAll(scb)
		require.NoError(t, err)
		assert.Equal(t, stream, string(read), "consumer must receive the exact stream bytes")
		require.NoError(t, scb.Close())

		assert.Equal(t, []string{`{"a":1}`, `{"b":2}`}, acc.consumed, "data payloads fed, [DONE] excluded")
		assert.Equal(t, 1, acc.finished, "finish runs exactly once")
		assert.Equal(t, 1, reqCalls, "request attrs recorded once at finish")
		spans := exp.GetSpans()
		require.Len(t, spans, 1, "the span ended exactly once")
		// TTFT is recorded once, on the first streamed chunk.
		ttft, ok := spanAttr(spans[0], attribute.Key("gen_ai.response.time_to_first_chunk"))
		require.True(t, ok, "TTFT must be recorded for a streamed response")
		assert.GreaterOrEqual(t, ttft.AsFloat64(), 0.0)
	})

	t.Run("it reassembles a data line that arrives across multiple reads", func(t *testing.T) {
		span, _ := newCaptureTestSpan(t)
		acc := &recordingAccumulator{}
		scb := newStreamingCaptureBody(newStubBody("data: {\"x\":1}\n"), span, acc, langwatch.DataCaptureAll, nil, time.Now())

		buf := make([]byte, 1) // one byte per read to force partial-line buffering
		for {
			_, err := scb.Read(buf)
			if err == io.EOF {
				break
			}
			require.NoError(t, err)
		}
		assert.Equal(t, []string{`{"x":1}`}, acc.consumed)
	})

	t.Run("it finishes as soon as the terminal marker is seen", func(t *testing.T) {
		// A trailing keep-alive line after [DONE] must not delay span completion.
		span, exp := newCaptureTestSpan(t)
		acc := &recordingAccumulator{}
		scb := newStreamingCaptureBody(newStubBody("data: {\"a\":1}\n\ndata: [DONE]\n"), span, acc, langwatch.DataCaptureAll, nil, time.Now())

		_, err := io.ReadAll(scb)
		require.NoError(t, err)
		assert.Equal(t, 1, acc.finished)
		assert.Len(t, exp.GetSpans(), 1)
	})
}
