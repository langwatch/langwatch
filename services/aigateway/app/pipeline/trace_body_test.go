package pipeline

// Tests for traceStreamWrapper's response-body accumulator. Without
// this accumulator the trace span sees nil ResponseBody on every
// streamed call, which makes extractOutputMessages return "" and the
// gen_ai.output.messages attribute is never stamped — every streaming
// Path A trace renders an empty output cell.

import (
	"bytes"
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestTraceStreamWrapper_AccumulatesChunksIntoResponseBody(t *testing.T) {
	chunks := [][]byte{
		[]byte("event: content_block_delta\n"),
		[]byte(`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"PO"}}` + "\n\n"),
		[]byte("event: content_block_delta\n"),
		[]byte(`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"NG"}}` + "\n\n"),
	}
	stub := newChunkedStub(chunks)
	captured := newCapturedEnd()
	wrapper := &traceStreamWrapper{
		inner:   stub,
		end:     captured.End,
		bundle:  &domain.Bundle{ProjectID: "proj_test"},
		req:     &domain.Request{Type: domain.RequestTypeMessages, Resolved: &domain.ResolvedModel{ModelID: "claude-haiku-4-5"}},
		meta:    &Meta{},
		spanCtx: context.Background(),
	}
	for wrapper.Next(context.Background()) {
		// Caller would normally read Chunk() and forward to the writer.
		// Drain the chunk here so we mirror the real Next/Chunk cycle.
		_ = wrapper.Chunk()
	}
	require.NoError(t, wrapper.Err())
	captured.WaitForEnd(t)

	concat := bytes.Join(chunks, nil)
	assert.Equal(t, concat, captured.params.ResponseBody,
		"trace wrapper must hand the full concatenated SSE buffer to the emitter")
	assert.Equal(t, "proj_test", captured.params.ProjectID)
	assert.Equal(t, domain.RequestTypeMessages, captured.params.RequestType)
}

func TestTraceStreamWrapper_CapsBodyAtResponseBodyCap(t *testing.T) {
	// One oversized chunk crosses the cap by 1 byte; the accumulator
	// must keep exactly responseBodyCap bytes and drop the rest, never
	// growing the buffer past the cap (OOM guard).
	huge := bytes.Repeat([]byte("x"), responseBodyCap+1)
	stub := newChunkedStub([][]byte{huge})
	captured := newCapturedEnd()
	wrapper := &traceStreamWrapper{
		inner:   stub,
		end:     captured.End,
		bundle:  &domain.Bundle{ProjectID: "proj_test"},
		req:     &domain.Request{Type: domain.RequestTypeChat, Resolved: &domain.ResolvedModel{ModelID: "gpt-5"}},
		meta:    &Meta{},
		spanCtx: context.Background(),
	}
	for wrapper.Next(context.Background()) {
		_ = wrapper.Chunk()
	}
	captured.WaitForEnd(t)
	assert.Equal(t, responseBodyCap, len(captured.params.ResponseBody),
		"accumulator must clamp to responseBodyCap")
}

func TestTraceStreamWrapper_AccumulatorCapsCumulativeChunks(t *testing.T) {
	// Two chunks each below the cap but their sum exceeds it. Second
	// chunk must be partially captured so total length equals the cap.
	half := bytes.Repeat([]byte("a"), responseBodyCap-100)
	tail := bytes.Repeat([]byte("b"), 200)
	stub := newChunkedStub([][]byte{half, tail})
	captured := newCapturedEnd()
	wrapper := &traceStreamWrapper{
		inner:   stub,
		end:     captured.End,
		bundle:  &domain.Bundle{ProjectID: "proj_test"},
		req:     &domain.Request{Type: domain.RequestTypeChat, Resolved: &domain.ResolvedModel{ModelID: "gpt-5"}},
		meta:    &Meta{},
		spanCtx: context.Background(),
	}
	for wrapper.Next(context.Background()) {
		_ = wrapper.Chunk()
	}
	captured.WaitForEnd(t)
	assert.Equal(t, responseBodyCap, len(captured.params.ResponseBody))
	// First (responseBodyCap-100) bytes are 'a', remaining 100 are 'b'.
	assert.Equal(t, byte('a'), captured.params.ResponseBody[0])
	assert.Equal(t, byte('b'), captured.params.ResponseBody[responseBodyCap-1])
}

func TestTraceStreamWrapper_CaptureOncePerChunk(t *testing.T) {
	// Caller may legally call Chunk() multiple times for a single
	// inner advance (e.g. retry middleware re-reading the active
	// frame). The accumulator must NOT double-count those reads.
	chunks := [][]byte{[]byte("AAA"), []byte("BB")}
	stub := newChunkedStub(chunks)
	captured := newCapturedEnd()
	wrapper := &traceStreamWrapper{
		inner:   stub,
		end:     captured.End,
		bundle:  &domain.Bundle{ProjectID: "proj_test"},
		req:     &domain.Request{Type: domain.RequestTypeChat, Resolved: &domain.ResolvedModel{ModelID: "gpt-5"}},
		meta:    &Meta{},
		spanCtx: context.Background(),
	}
	for wrapper.Next(context.Background()) {
		_ = wrapper.Chunk()
		_ = wrapper.Chunk() // second read of the same active chunk
		_ = wrapper.Chunk()
	}
	captured.WaitForEnd(t)
	assert.Equal(t, []byte("AAABB"), captured.params.ResponseBody)
}

// chunkedStub is a domain.StreamIterator that yields a fixed sequence
// of byte slices, one per Next() call.
type chunkedStub struct {
	chunks [][]byte
	idx    int
	cur    []byte
}

func newChunkedStub(chunks [][]byte) *chunkedStub {
	return &chunkedStub{chunks: chunks}
}

func (s *chunkedStub) Next(_ context.Context) bool {
	if s.idx >= len(s.chunks) {
		return false
	}
	s.cur = s.chunks[s.idx]
	s.idx++
	return true
}

func (s *chunkedStub) Chunk() []byte       { return s.cur }
func (s *chunkedStub) Usage() domain.Usage { return domain.Usage{} }
func (s *chunkedStub) Err() error          { return nil }
func (s *chunkedStub) Close() error        { return nil }

// capturedEnd records the AITraceParams the wrapper hands to the
// emitter on stream close, with a goroutine-safe latch so tests can
// wait for the forked onClose to finish.
type capturedEnd struct {
	mu     sync.Mutex
	params domain.AITraceParams
	called atomic.Bool
}

func newCapturedEnd() *capturedEnd { return &capturedEnd{} }

func (c *capturedEnd) End(_ context.Context, p domain.AITraceParams) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.params = p
	c.called.Store(true)
}

func (c *capturedEnd) WaitForEnd(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if c.called.Load() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("trace wrapper onClose did not call end() within 2s")
}
