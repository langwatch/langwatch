package pipeline

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Regression: Gemini /v1beta/streamGenerateContent passthrough was
// emitting `data: data: {json}\n\n` — double-wrapped — because the
// pipeline's stream wrappers (trace, guardrail) didn't
// forward the inner iterator's RawFraming() marker. The outermost
// iterator the router saw was a wrapper that didn't implement
// domain.RawFramer, so writeSSE fell through to the default framing
// branch.
//
// The fix: every wrapper must forward RawFraming() via a delegating
// method so RawFramer propagates through the full chain.
func TestGuardrailStreamWrapper_ForwardsRawFraming(t *testing.T) {
	inner := &rawFramerStub{raw: true}
	w := &guardrailStreamWrapper{inner: inner}

	rf, ok := any(w).(domain.RawFramer)
	require.True(t, ok, "guardrailStreamWrapper must implement domain.RawFramer")
	assert.True(t, rf.RawFraming())
}

func TestTraceStreamWrapper_ForwardsRawFraming(t *testing.T) {
	inner := &rawFramerStub{raw: true}
	w := &traceStreamWrapper{inner: inner}

	rf, ok := any(w).(domain.RawFramer)
	require.True(t, ok, "traceStreamWrapper must implement domain.RawFramer")
	assert.True(t, rf.RawFraming())
}

// Full chain: simulate what pipeline.Build produces for streaming
// passthrough and verify the outer iter exposes RawFraming().
func TestStreamWrapperChain_PreservesRawFraming(t *testing.T) {
	inner := &rawFramerStub{raw: true}

	// Outer → inner: guardrail(trace(bifrost))
	layered := domain.StreamIterator(&traceStreamWrapper{inner: inner})
	layered = &guardrailStreamWrapper{inner: layered}

	rf, ok := any(layered).(domain.RawFramer)
	require.True(t, ok, "outer wrapper must implement domain.RawFramer so writeSSE can detect raw framing through the full chain")
	assert.True(t, rf.RawFraming(), "RawFraming must propagate from bifrostStreamIterator all the way to the router's writeSSE check")
}

// rawFramerStub is a minimal StreamIterator that also implements
// domain.RawFramer — mirrors bifrostStreamIterator's runtime shape
// without pulling in the provider package.
type rawFramerStub struct {
	raw bool
}

func (*rawFramerStub) Next(_ context.Context) bool { return false }
func (*rawFramerStub) Chunk() []byte               { return nil }
func (*rawFramerStub) Usage() domain.Usage         { return domain.Usage{} }
func (*rawFramerStub) Err() error                  { return nil }
func (*rawFramerStub) Close() error                { return nil }
func (s *rawFramerStub) RawFraming() bool          { return s.raw }
