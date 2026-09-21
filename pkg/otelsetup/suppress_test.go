package otelsetup

import (
	"context"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/stretchr/testify/assert"
)

func TestSuppressAwareSampler_DropsWhenMarkerPresent(t *testing.T) {
	inner := sdktrace.AlwaysSample()
	sampler := NewSuppressAwareSampler(inner)

	ctx := WithTraceSuppressed(context.Background())
	result := sampler.ShouldSample(sdktrace.SamplingParameters{
		ParentContext: ctx,
		TraceID:       trace.TraceID{1},
	})

	assert.Equal(t, sdktrace.Drop, result.Decision,
		"suppressed context must drop regardless of inner sampler")
}

func TestSuppressAwareSampler_DelegatesWithoutMarker(t *testing.T) {
	inner := sdktrace.AlwaysSample()
	sampler := NewSuppressAwareSampler(inner)

	result := sampler.ShouldSample(sdktrace.SamplingParameters{
		ParentContext: context.Background(),
		TraceID:       trace.TraceID{1},
	})

	assert.Equal(t, sdktrace.RecordAndSample, result.Decision,
		"unmarked context must delegate to inner sampler")
}

func TestSuppressAwareSampler_DelegatesNeverSample(t *testing.T) {
	inner := sdktrace.NeverSample()
	sampler := NewSuppressAwareSampler(inner)

	result := sampler.ShouldSample(sdktrace.SamplingParameters{
		ParentContext: context.Background(),
		TraceID:       trace.TraceID{1},
	})

	assert.Equal(t, sdktrace.Drop, result.Decision,
		"unmarked context with NeverSample must drop")
}

func TestSuppressAwareSampler_Description(t *testing.T) {
	inner := sdktrace.AlwaysSample()
	sampler := NewSuppressAwareSampler(inner)

	assert.Equal(t, "SuppressAware{AlwaysOnSampler}", sampler.Description())
}

func TestIsTraceSuppressed_FalseByDefault(t *testing.T) {
	assert.False(t, IsTraceSuppressed(context.Background()))
}

func TestIsTraceSuppressed_TrueWhenSet(t *testing.T) {
	ctx := WithTraceSuppressed(context.Background())
	assert.True(t, IsTraceSuppressed(ctx))
}
