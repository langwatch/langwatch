package customertracebridge

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

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

	cacheRead, ok := findIntAttr(span, AttrGenAIUsageCacheRead)
	require.True(t, ok, "span must carry gen_ai.usage.cache_read.input_tokens")
	assert.Equal(t, int64(37127), cacheRead)

	cacheCreate, ok := findIntAttr(span, AttrGenAIUsageCacheCreate)
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

	input, ok := findIntAttr(span, AttrGenAIUsageIn)
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

	_, hasRead := findIntAttr(span, AttrGenAIUsageCacheRead)
	assert.False(t, hasRead, "no cache-read attr when there is no cache activity")
	_, hasCreate := findIntAttr(span, AttrGenAIUsageCacheCreate)
	assert.False(t, hasCreate, "no cache-creation attr when there is no cache activity")

	input, ok := findIntAttr(span, AttrGenAIUsageIn)
	require.True(t, ok)
	assert.Equal(t, int64(100), input, "input_tokens is the full prompt when there is no cache activity")
}

// Anthropic prices a cache write by how long the entry lives, and states the
// split in its own response body. The span has to carry it or the control
// plane prices every write short-lived and comes out under the bill.
//
// @scenario "A cache write bought for an hour is recorded as such on the span"
func TestEmitter_HourLongCacheWrite_RecordsTheLifetime(t *testing.T) {
	// The hour-long count is a PORTION of the writes, so the two differ here.
	// Equal values would let an emitter that wrote the total into the hour-long
	// attr pass, which is the mistake most worth catching: it would price
	// short-lived writes at twice the input rate.
	span := recordSpanForUsage(t, domain.Usage{
		PromptTokens:          36299,
		CompletionTokens:      210,
		TotalTokens:           36509,
		CacheReadTokens:       18443,
		CacheCreationTokens:   17854,
		CacheCreation1hTokens: 12000,
	})

	oneHour, ok := findIntAttr(span, AttrGenAIUsageCacheCreate1h)
	require.True(t, ok, "span must carry gen_ai.usage.cache_creation_1h.input_tokens")
	assert.Equal(t, int64(12000), oneHour)

	writes, ok := findIntAttr(span, AttrGenAIUsageCacheCreate)
	require.True(t, ok, "span must still carry the total write count")
	assert.Equal(t, int64(17854), writes)
}

// @scenario "A cache write whose lifetime the provider did not state is left unqualified"
func TestEmitter_UnstatedCacheWriteLifetime_RecordsNoHourLongAttr(t *testing.T) {
	span := recordSpanForUsage(t, domain.Usage{
		PromptTokens:        36299,
		CompletionTokens:    210,
		TotalTokens:         36509,
		CacheReadTokens:     18443,
		CacheCreationTokens: 17854,
	})

	_, ok := findIntAttr(span, AttrGenAIUsageCacheCreate1h)
	assert.False(t, ok, "no hour-long attr when the provider did not state the split")
}

// The raw-forward lane takes its write total from Bifrost's normalized usage
// struct and the hour-long split off the provider's bytes. On an
// Anthropic-native response the struct reports no writes, so the producer
// reconciles the pair before the usage reaches here. This pins what that
// reconciliation buys: the written tokens leave the fresh input count exactly
// once, instead of being billed as input AND again at the hour-long rate.
//
// @scenario "An hour-long cache write is not also counted as fresh input"
func TestEmitter_HourLongWriteWithNoNormalizedTotal_LeavesFreshInputExcludingIt(t *testing.T) {
	// What the raw-forward lane hands over: the normalized struct carried no
	// cache-write count, the body said 17854 of the writes bought an hour.
	usage := domain.Usage{
		PromptTokens:          36299,
		CompletionTokens:      210,
		TotalTokens:           36509,
		CacheReadTokens:       18443,
		CacheCreationTokens:   0,
		CacheCreation1hTokens: 17854,
	}.ReconcileCacheWrites()

	span := recordSpanForUsage(t, usage)

	input, ok := findIntAttr(span, AttrGenAIUsageIn)
	require.True(t, ok)
	read, ok := findIntAttr(span, AttrGenAIUsageCacheRead)
	require.True(t, ok)
	writes, ok := findIntAttr(span, AttrGenAIUsageCacheCreate)
	require.True(t, ok)
	oneHour, ok := findIntAttr(span, AttrGenAIUsageCacheCreate1h)
	require.True(t, ok)

	assert.Equal(t, int64(2), input, "fresh input is the prompt minus what came from and went to the cache")
	assert.Equal(t, int64(17854), writes, "the write total covers the hour-long writes")
	assert.Equal(t, int64(17854), oneHour)
	assert.Equal(t, int64(36299), input+read+writes,
		"every prompt token is counted in exactly one bucket")
}
