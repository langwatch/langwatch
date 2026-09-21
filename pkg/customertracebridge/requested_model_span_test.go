package customertracebridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// gen_ai.request.model carries the model that was dispatched, so a request a
// routing policy rewrote leaves no record of the name the client sent. The
// caller's own vocabulary is what answers "who still sends gpt-4o" and "is
// anyone using the complex tier", and repointing a tier would otherwise
// rewrite what every past trace appears to have asked for.
//
// recordSpanForParams comes from emitter_error_suppress_test.go.

func TestEmitter_RequestedModel_StampedOnSpan(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:     domain.ProviderOpenAI,
		Model:          "gpt-5.6-sol",
		RequestedModel: "complex",
		VirtualKeyID:   "vk_1",
		Usage:          domain.Usage{CompletionTokens: 5},
	})

	got, ok := hasStringAttr(span, AttrRequestedModel)
	require.True(t, ok, "span must carry %s when a policy rewrote the name", AttrRequestedModel)
	assert.Equal(t, "complex", got)

	served, ok := hasStringAttr(span, "gen_ai.request.model")
	require.True(t, ok)
	assert.Equal(t, "openai/gpt-5.6-sol", served,
		"the dispatched model keeps its own attribute")
}

// Most requests name the model they get. Stamping the same value twice would
// make the attribute mean nothing when it is present.
func TestEmitter_NoRequestedModel_NoAttribute(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:   domain.ProviderOpenAI,
		Model:        "gpt-5.6-sol",
		VirtualKeyID: "vk_1",
		Usage:        domain.Usage{CompletionTokens: 5},
	})

	_, ok := hasStringAttr(span, AttrRequestedModel)
	assert.False(t, ok, "span must not carry an empty %s", AttrRequestedModel)
}
