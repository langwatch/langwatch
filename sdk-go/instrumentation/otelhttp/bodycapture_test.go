package otelhttp

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

type stubBody struct {
	r      *strings.Reader
	closed bool
}

func newStubBody(s string) *stubBody           { return &stubBody{r: strings.NewReader(s)} }
func (s *stubBody) Read(p []byte) (int, error) { return s.r.Read(p) }
func (s *stubBody) Close() error               { s.closed = true; return nil }

func TestCapturingBody(t *testing.T) {
	t.Run("it passes bytes through unchanged and captures once at EOF", func(t *testing.T) {
		const payload = `{"object":"x"}`
		var captured []byte
		calls := 0
		src := newStubBody(payload)
		cb := newCapturingBody(src, func(b []byte, truncated bool) {
			calls++
			captured = append([]byte(nil), b...)
			assert.False(t, truncated)
		})

		got, err := io.ReadAll(cb)
		require.NoError(t, err)
		require.NoError(t, cb.Close())
		assert.Equal(t, payload, string(got))
		assert.Equal(t, payload, string(captured))
		assert.Equal(t, 1, calls)
		assert.True(t, src.closed)
	})

	t.Run("it completes on Close after a partial read", func(t *testing.T) {
		calls := 0
		cb := newCapturingBody(newStubBody("abcdef"), func([]byte, bool) { calls++ })
		_, err := cb.Read(make([]byte, 3))
		require.NoError(t, err)
		assert.Equal(t, 0, calls)
		require.NoError(t, cb.Close())
		assert.Equal(t, 1, calls)
	})

	t.Run("it truncates a body larger than the cap", func(t *testing.T) {
		var truncated bool
		var capturedLen int
		big := strings.Repeat("a", maxCaptureBytes+4096)
		cb := newCapturingBody(newStubBody(big), func(b []byte, tr bool) {
			truncated = tr
			capturedLen = len(b)
		})
		got, err := io.ReadAll(cb)
		require.NoError(t, err)
		assert.Len(t, got, len(big), "the consumer still receives the whole body")
		assert.True(t, truncated)
		assert.Equal(t, maxCaptureBytes, capturedLen)
	})
}

func TestBoundedBuffer(t *testing.T) {
	t.Run("it stops at the cap", func(t *testing.T) {
		bb := boundedBuffer{buf: new(bytes.Buffer)}
		bb.write(make([]byte, maxCaptureBytes+1))
		assert.True(t, bb.truncated)
		assert.Equal(t, maxCaptureBytes, bb.buf.Len())
		bb.write([]byte("x"))
		assert.Equal(t, maxCaptureBytes, bb.buf.Len())
	})
}

type recAccumulator struct {
	consumed []string
	finished int
}

func (r *recAccumulator) Consume(s string)         { r.consumed = append(r.consumed, s) }
func (r *recAccumulator) IsTerminal(s string) bool { return s == "[DONE]" }
func (r *recAccumulator) Finish(*langwatch.Span, langwatch.DataCaptureMode) {
	r.finished++
}

func testSpan(t *testing.T) (*langwatch.Span, *tracetest.InMemoryExporter) {
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
	t.Run("it passes the stream through byte-exact and feeds data payloads", func(t *testing.T) {
		const stream = "data: {\"a\":1}\n\ndata: {\"b\":2}\n\ndata: [DONE]\n\n"
		span, exp := testSpan(t)
		acc := &recAccumulator{}
		reqCalls := 0
		scb := newStreamingCaptureBody(newStubBody(stream), span, acc, langwatch.DataCaptureAll, func() { reqCalls++ }, FramingSSE, time.Now())

		got, err := io.ReadAll(scb)
		require.NoError(t, err)
		require.NoError(t, scb.Close())
		assert.Equal(t, stream, string(got))
		assert.Equal(t, []string{`{"a":1}`, `{"b":2}`}, acc.consumed)
		assert.Equal(t, 1, acc.finished)
		assert.Equal(t, 1, reqCalls)
		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		// TTFT is recorded once, on the first streamed chunk.
		ttft, ok := spanAttr(spans[0], attribute.Key("gen_ai.response.time_to_first_chunk"))
		require.True(t, ok, "TTFT must be recorded for a streamed response")
		assert.GreaterOrEqual(t, ttft.AsFloat64(), 0.0)
	})

	t.Run("it reassembles a data line split across reads", func(t *testing.T) {
		span, _ := testSpan(t)
		acc := &recAccumulator{}
		scb := newStreamingCaptureBody(newStubBody("data: {\"x\":1}\n"), span, acc, langwatch.DataCaptureAll, nil, FramingSSE, time.Now())
		buf := make([]byte, 1)
		for {
			_, err := scb.Read(buf)
			if err == io.EOF {
				break
			}
			require.NoError(t, err)
		}
		assert.Equal(t, []string{`{"x":1}`}, acc.consumed)
	})
}

func TestStreamingCaptureBodyNDJSON(t *testing.T) {
	t.Run("it feeds each newline-delimited JSON object as a payload and ends at EOF", func(t *testing.T) {
		const stream = "{\"a\":1}\n{\"b\":2}\n{\"done\":true}\n"
		span, exp := testSpan(t)
		acc := &recAccumulator{}
		scb := newStreamingCaptureBody(newStubBody(stream), span, acc, langwatch.DataCaptureAll, nil, FramingNDJSON, time.Now())

		got, err := io.ReadAll(scb)
		require.NoError(t, err)
		assert.Equal(t, stream, string(got), "consumer receives the exact bytes")
		assert.Equal(t, []string{`{"a":1}`, `{"b":2}`, `{"done":true}`}, acc.consumed)
		assert.Equal(t, 1, acc.finished, "finishes once on EOF (no [DONE] sentinel)")
		assert.Len(t, exp.GetSpans(), 1)
	})
}
