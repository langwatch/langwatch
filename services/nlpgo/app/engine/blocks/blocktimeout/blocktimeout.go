// Package blocktimeout resolves the wall-clock budget for one block call from
// the operator's ceiling and the node's own `timeout_ms`.
//
// Every block that reaches an outside system takes its budget from an operator
// knob under the `NLPGO_ENGINE_` prefix. A workflow node may name its own
// `timeout_ms`, but that number is a request for a SHORTER budget: it can
// never buy more than the deployment allows. This package is where that rule
// is expressed once, so the four blocks that enforce it cannot drift apart.
package blocktimeout

import (
	"math"
	"time"
)

// maxMillis is the largest millisecond count that still converts to a
// time.Duration (an int64 nanosecond count) without overflowing.
const maxMillis = int64(math.MaxInt64) / int64(time.Millisecond)

// Clamp returns the budget for one call: the operator's ceiling, shortened by
// askedMS when — and only when — that request is positive and smaller.
//
// The comparison happens in milliseconds, BEFORE any conversion to a Duration.
// Converting first is the bug this exists to prevent: askedMS above ~9.2e12
// overflows int64 when multiplied by time.Millisecond and wraps to a negative
// duration, which reads as "smaller than the ceiling" and makes
// context.WithTimeout expire the call before it is sent — turning "a node can
// only shorten its budget" into "a big enough number fails instantly".
func Clamp(ceiling time.Duration, askedMS int) time.Duration {
	if askedMS <= 0 {
		return ceiling
	}
	if ceilingMS := int64(ceiling / time.Millisecond); int64(askedMS) >= ceilingMS {
		return ceiling
	}
	return time.Duration(askedMS) * time.Millisecond
}

// FromMillis converts a node's `timeout_ms` to a duration for an executor that
// clamps the value itself, yielding 0 — "no request, use your default" — for
// anything non-positive or large enough that the conversion would overflow.
func FromMillis(ms int) time.Duration {
	if ms <= 0 || int64(ms) > maxMillis {
		return 0
	}
	return time.Duration(ms) * time.Millisecond
}
