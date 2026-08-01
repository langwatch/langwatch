package otel

import (
	"crypto/rand"
	"encoding/binary"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/trace"
)

// MintSpanContext returns a valid, sampled span context with random ids: a
// customer-facing trace identity minted by the manager itself.
//
// A turn's trace identity normally comes from the manager's own turn span (or,
// with the ops tracer unarmed, from the control plane's inbound traceparent).
// When BOTH are absent (dev without an OTLP endpoint on either process) the
// turn would have no identity at all, and every leg that keys on it degrades at
// once: worker spans keep their own trace ids, the customer turn root is never
// forwarded, and the gateway's gen_ai span roots a standalone trace that
// duplicates the turn in the trace explorer. Minting an identity keeps the
// turn ONE trace regardless of which tracers happen to be armed.
//
// Sampled is deliberate: the minted context exists purely for the customer
// plane, which must always receive the turn's spans.
func MintSpanContext() trace.SpanContext {
	var traceID trace.TraceID
	var spanID trace.SpanID
	fillNonZero(traceID[:])
	fillNonZero(spanID[:])
	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})
}

// mintFallbackCounter feeds the entropy-exhaustion fallback ids; package-level
// so consecutive fallback mints stay distinct.
var mintFallbackCounter atomic.Uint64

// fillNonZero fills b with random bytes, guaranteeing a non-zero result (an
// all-zero trace or span id is the OTel invalid value). crypto/rand cannot
// fail on supported platforms; if it ever does, a timestamp+counter fallback
// keeps the id unique and non-zero rather than panicking mid-turn.
func fillNonZero(b []byte) {
	if _, err := rand.Read(b); err == nil && !allZero(b) {
		return
	}
	// |1 keeps the word non-zero; the counter keeps same-nanosecond mints
	// distinct for 8-byte span ids too.
	word := (uint64(time.Now().UnixNano()) ^ (mintFallbackCounter.Add(1) << 1)) | 1
	binary.BigEndian.PutUint64(b[:8], word)
	if len(b) > 8 {
		binary.BigEndian.PutUint64(b[8:], mintFallbackCounter.Add(1))
	}
}

func allZero(b []byte) bool {
	for _, v := range b {
		if v != 0 {
			return false
		}
	}
	return true
}
