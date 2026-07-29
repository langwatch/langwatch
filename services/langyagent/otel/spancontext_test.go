package otel

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The minted identity is what keeps a turn ONE trace when no tracer is armed
// anywhere: worker re-parenting, the customer turn root, and the gateway's
// traceparent all key on it being valid and sampled.
//
// @scenario "A turn stays one trace even when the manager runs without its own telemetry"
func TestMintSpanContext(t *testing.T) {
	t.Run("mints a valid, sampled context", func(t *testing.T) {
		sc := MintSpanContext()
		require.True(t, sc.IsValid(), "a minted context must be usable as a turn identity")
		assert.True(t, sc.IsSampled(),
			"the customer plane must always receive the turn's spans")
	})

	t.Run("mints distinct identities per call", func(t *testing.T) {
		a, b := MintSpanContext(), MintSpanContext()
		assert.NotEqual(t, a.TraceID(), b.TraceID(), "two turns must never share a trace")
		assert.NotEqual(t, a.SpanID(), b.SpanID())
	})
}

func TestFillNonZero(t *testing.T) {
	t.Run("fills an 8-byte id non-zero and distinct across calls", func(t *testing.T) {
		var a, b [8]byte
		fillNonZero(a[:])
		fillNonZero(b[:])
		assert.False(t, allZero(a[:]), "an all-zero id is the OTel invalid value")
		assert.False(t, allZero(b[:]))
		assert.NotEqual(t, a, b)
	})
}
