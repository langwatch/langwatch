package customertracebridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// VK tags must land on the customer span as the langwatch.labels attribute:
// the trace pipeline ingests exactly that key into metadata.labels, which
// the Trace Explorer filters as "Label" — no explorer-side changes needed.
// recordSpanForParams comes from emitter_error_suppress_test.go.
//
// Spec: specs/ai-gateway/span-shape.feature

func findSliceAttr(span sdktrace.ReadOnlySpan, key string) ([]string, bool) {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == key {
			return kv.Value.AsStringSlice(), true
		}
	}
	return nil, false
}

// @scenario "Virtual-key tags are stamped on the customer span as labels"
func TestEmitter_VKTags_StampedAsLabels(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID: domain.ProviderAnthropic,
		Model:      "qwen3-14b",
		VKTags:     []string{"app=nexttrace", "team=offsecops"},
		Usage:      domain.Usage{CompletionTokens: 5},
	})

	labels, ok := findSliceAttr(span, "langwatch.labels")
	require.True(t, ok, "span must carry langwatch.labels when the VK has tags")
	assert.Equal(t, []string{"app=nexttrace", "team=offsecops"}, labels)
}

// @scenario "A VK without tags stamps no labels attribute"
func TestEmitter_NoVKTags_NoLabelsAttribute(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID: domain.ProviderAnthropic,
		Model:      "qwen3-14b",
		Usage:      domain.Usage{CompletionTokens: 5},
	})

	_, ok := findSliceAttr(span, "langwatch.labels")
	assert.False(t, ok, "span must not carry an empty langwatch.labels attribute")
}
