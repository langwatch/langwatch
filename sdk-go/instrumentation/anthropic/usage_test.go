package anthropic

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// TestRecordUsage_TotalIncludesCacheTokens verifies the synthesized total
// includes cache-read and cache-creation tokens (real input tokens), so usage is
// not understated.
func TestRecordUsage_TotalIncludesCacheTokens(t *testing.T) {
	provider, exporter := newTestProvider(t)
	tracer := langwatch.TracerFromProvider(provider, "test")
	_, span := tracer.Start(t.Context(), "usage")

	recordUsage(span, usage{
		inputTokens:              10,
		outputTokens:             5,
		cacheReadInputTokens:     4,
		cacheCreationInputTokens: 6,
	})
	span.End()

	read := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(read)

	// 10 + 5 + 4 + 6 = 25 (not the cache-excluding 15).
	assert.Equal(t, attribute.IntValue(25), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(4), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
}

// TestRecordUsage_CacheOnly_StillTotals verifies that even when there is no
// non-cached input, cache tokens contribute to the total (they are billed input
// tokens).
func TestRecordUsage_CacheOnly_StillTotals(t *testing.T) {
	provider, exporter := newTestProvider(t)
	tracer := langwatch.TracerFromProvider(provider, "test")
	_, span := tracer.Start(t.Context(), "usage")

	recordUsage(span, usage{
		inputTokens:          0,
		outputTokens:         8,
		cacheReadInputTokens: 100,
	})
	span.End()

	read := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(read)

	// 0 + 8 + 100 = 108.
	require.Contains(t, attrs, attribute.Key("gen_ai.usage.total_tokens"))
	assert.Equal(t, attribute.IntValue(108), attrs[attribute.Key("gen_ai.usage.total_tokens")])
}
