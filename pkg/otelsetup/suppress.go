package otelsetup

import (
	"context"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

type suppressTraceKey struct{}

// WithTraceSuppressed returns a context that tells SuppressAwareSampler to
// drop every span started from it, regardless of the configured sampler.
// This is the primary suppression mechanism for do_not_trace requests —
// it works with any sampler choice (always_on, traceidratio, parent-based).
func WithTraceSuppressed(ctx context.Context) context.Context {
	return context.WithValue(ctx, suppressTraceKey{}, true)
}

// IsTraceSuppressed reports whether the context carries the suppression marker.
func IsTraceSuppressed(ctx context.Context) bool {
	v, _ := ctx.Value(suppressTraceKey{}).(bool)
	return v
}

// SuppressAwareSampler wraps any sdktrace.Sampler and unconditionally drops
// spans when the parent context carries the suppression marker set by
// WithTraceSuppressed. When the marker is absent it delegates to the inner
// sampler unchanged.
type SuppressAwareSampler struct {
	inner sdktrace.Sampler
}

// NewSuppressAwareSampler wraps inner so that context-level trace suppression
// takes precedence over any sampling configuration.
func NewSuppressAwareSampler(inner sdktrace.Sampler) sdktrace.Sampler {
	return &SuppressAwareSampler{inner: inner}
}

// ShouldSample drops the span when the parent context is suppressed, otherwise delegates.
func (s *SuppressAwareSampler) ShouldSample(p sdktrace.SamplingParameters) sdktrace.SamplingResult {
	if IsTraceSuppressed(p.ParentContext) {
		return sdktrace.SamplingResult{Decision: sdktrace.Drop}
	}
	return s.inner.ShouldSample(p)
}

// Description returns the inner sampler's description wrapped with the suppression label.
func (s *SuppressAwareSampler) Description() string {
	return "SuppressAware{" + s.inner.Description() + "}"
}
