package langwatch

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
)

// @scenario "Custom metadata is hoisted as first-class attributes"
func TestSetTraceMetadata(t *testing.T) {
	t.Run("it records individual hoistable metadata.<key> attributes, not a blob", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTraceMetadata(
				Origin("api"),
				attribute.String("feature", "checkout"),
				attribute.Int("attempt", 2),
			)
		})
		assert.Equal(t, "api", attrs["metadata.origin"].AsString())
		assert.Equal(t, "checkout", attrs["metadata.feature"].AsString())
		assert.EqualValues(t, 2, attrs["metadata.attempt"].AsInt64())
		_, blob := attrs[AttributeLangWatchMetadata]
		assert.False(t, blob, "no langwatch.metadata JSON blob is emitted")
	})

	t.Run("the map convenience and SetOrigin namespace under metadata.", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTraceMetadataMap(map[string]any{"tier": "pro", "retries": 3}).SetOrigin("cron")
		})
		assert.Equal(t, "pro", attrs["metadata.tier"].AsString())
		assert.EqualValues(t, 3, attrs["metadata.retries"].AsInt64())
		assert.Equal(t, "cron", attrs["metadata.origin"].AsString())
	})

	t.Run("an already-namespaced key is not double-prefixed", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTraceMetadata(attribute.String("metadata.foo", "bar"))
		})
		assert.Equal(t, "bar", attrs["metadata.foo"].AsString())
		_, doubled := attrs["metadata.metadata.foo"]
		assert.False(t, doubled)
	})
}

// @scenario "Reserved metadata is promoted to trace identity"
func TestReservedMetadataSetters(t *testing.T) {
	t.Run("identity setters write the canonical reserved keys", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetThreadID("t-1").SetUserID("u-1").SetCustomerID("c-1").SetLabels("a", "b")
		})
		assert.Equal(t, "t-1", attrs["gen_ai.conversation.id"].AsString(), "thread maps to gen_ai.conversation.id")
		assert.Equal(t, "u-1", attrs[AttributeLangWatchUserID].AsString())
		assert.Equal(t, "c-1", attrs[AttributeLangWatchCustomerID].AsString())
		assert.Equal(t, []string{"a", "b"}, attrs[AttributeLangWatchLabels].AsStringSlice())
	})
}
