package customertracebridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The dispatched provider's ModelProvider row id must land on the customer
// span as langwatch.model_provider_id: the control plane's trace fold reads
// exactly that key to decide which provider-filtered budgets a debit belongs
// to. Without it those budgets never accrue, and the failure is silent: every request
// still succeeds. recordSpanForParams comes from emitter_error_suppress_test.go.
//
// Spec: specs/ai-gateway/budgets.feature ("Spend is attributed to the
// provider that actually served the request"), contract §4.5.

func TestEmitter_ModelProviderID_StampedOnSpan(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:      domain.ProviderOpenAI,
		Model:           "gpt-5-mini",
		VirtualKeyID:    "vk_1",
		ModelProviderID: "mp_01HZX",
		Usage:           domain.Usage{CompletionTokens: 5},
	})

	got, ok := hasStringAttr(span, AttrModelProviderID)
	require.True(t, ok, "span must carry %s when a provider was dispatched", AttrModelProviderID)
	assert.Equal(t, "mp_01HZX", got)
}

// A request that never reached a provider (budget block, empty chain) has no
// provider to attribute; the attribute must be absent so the fold debits
// unfiltered budgets only instead of guessing a vendor.
func TestEmitter_NoModelProviderID_NoAttribute(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:   domain.ProviderOpenAI,
		Model:        "gpt-5-mini",
		VirtualKeyID: "vk_1",
		Usage:        domain.Usage{CompletionTokens: 5},
	})

	_, ok := hasStringAttr(span, AttrModelProviderID)
	assert.False(t, ok, "span must not carry an empty %s", AttrModelProviderID)
}
