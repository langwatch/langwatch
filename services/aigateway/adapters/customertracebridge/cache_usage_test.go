package customertracebridge

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Prompt-cache token telemetry: the customer span must carry the cache token
// breakdown (cache-read + cache-write) separately from the fresh input tokens,
// so downstream cost prices each bucket once. A cached follow-up was billed as
// if every prompt token were fresh input.
//
// Spec: specs/ai-gateway/cache-token-telemetry.feature

// recordSpanForUsage runs the emitter's span lifecycle for a given usage and
// returns the recorded span, captured via an in-memory recorder.
func recordSpanForUsage(t *testing.T, u domain.Usage) sdktrace.ReadOnlySpan {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	e := &Emitter{tp: tp, tracer: tp.Tracer("test"), propagator: propagation.TraceContext{}}

	ctx, _ := e.BeginSpan(context.Background(), "proj-test", domain.RequestTypeMessages)
	e.EndSpan(ctx, domain.AITraceParams{
		ProviderID: domain.ProviderAnthropic,
		Model:      "claude-opus-4-7",
		Usage:      u,
	})

	spans := sr.Ended()
	require.Len(t, spans, 1)
	return spans[0]
}

func findIntAttr(span sdktrace.ReadOnlySpan, key string) (int64, bool) {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == key {
			return kv.Value.AsInt64(), true
		}
	}
	return 0, false
}

// @scenario "A cached request records the cache-read and cache-write token counts on the span"
func TestEmitter_CachedRequest_RecordsCacheTokens(t *testing.T) {
	span := recordSpanForUsage(t, domain.Usage{
		PromptTokens:        37651, // provider total, includes cached tokens
		CompletionTokens:    12,
		TotalTokens:         37663,
		CacheReadTokens:     37127,
		CacheCreationTokens: 14,
	})

	cacheRead, ok := findIntAttr(span, gatewaytracer.AttrGenAIUsageCacheRead)
	require.True(t, ok, "span must carry gen_ai.usage.cache_read.input_tokens")
	assert.Equal(t, int64(37127), cacheRead)

	cacheCreate, ok := findIntAttr(span, gatewaytracer.AttrGenAIUsageCacheCreate)
	require.True(t, ok, "span must carry gen_ai.usage.cache_creation.input_tokens")
	assert.Equal(t, int64(14), cacheCreate)
}

// @scenario "The fresh input-token count excludes cached tokens"
func TestEmitter_FreshInputExcludesCacheTokens(t *testing.T) {
	span := recordSpanForUsage(t, domain.Usage{
		PromptTokens:        37651,
		CompletionTokens:    12,
		TotalTokens:         37663,
		CacheReadTokens:     37127,
		CacheCreationTokens: 14,
	})

	input, ok := findIntAttr(span, gatewaytracer.AttrGenAIUsageIn)
	require.True(t, ok)
	assert.Equal(t, int64(510), input,
		"input_tokens must be the non-cached remainder: PromptTokens - cache_read - cache_creation")
}

// @scenario "A request with no cache activity records no cache tokens"
func TestEmitter_NoCacheActivity_RecordsNoCacheTokens(t *testing.T) {
	span := recordSpanForUsage(t, domain.Usage{
		PromptTokens:     100,
		CompletionTokens: 20,
		TotalTokens:      120,
	})

	_, hasRead := findIntAttr(span, gatewaytracer.AttrGenAIUsageCacheRead)
	assert.False(t, hasRead, "no cache-read attr when there is no cache activity")
	_, hasCreate := findIntAttr(span, gatewaytracer.AttrGenAIUsageCacheCreate)
	assert.False(t, hasCreate, "no cache-creation attr when there is no cache activity")

	input, ok := findIntAttr(span, gatewaytracer.AttrGenAIUsageIn)
	require.True(t, ok)
	assert.Equal(t, int64(100), input, "input_tokens is the full prompt when there is no cache activity")
}
