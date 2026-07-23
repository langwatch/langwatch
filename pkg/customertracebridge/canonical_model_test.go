package customertracebridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The platform carries the provider-prefixed model id end to end (selectors,
// cost registry, playground, NLP executions). Model resolution strips the
// prefix for provider routing; the customer span must put it back, or the
// gateway is the one surface reporting bare wire-names and a turn's Models
// filter lists the same model twice under two spellings.
//
// @scenario "Every span of a turn names the model the same way"
func TestEndSpan_CanonicalModelID(t *testing.T) {
	t.Run("stamps the provider-prefixed id resolution stripped", func(t *testing.T) {
		p := baseParams()
		p.Model = "claude-haiku-4-5"
		p.ProviderID = domain.ProviderAnthropic
		ingest := emitWith(t, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", p)

		spans := ingest.spansByProject(t)["proj-customer"]
		require.Len(t, spans, 1)
		assert.Equal(t, "anthropic/claude-haiku-4-5", spans[0]["gen_ai.request.model"])
	})

	t.Run("keeps an implicit-resolution model as requested", func(t *testing.T) {
		// Implicit resolution never fills the provider; there is nothing to
		// prefix with, and the span reports the id the caller requested.
		p := baseParams()
		p.Model = "claude-haiku-4-5"
		p.ProviderID = ""
		ingest := emitWith(t, "", p)

		spans := ingest.spansByProject(t)["proj-customer"]
		require.Len(t, spans, 1)
		assert.Equal(t, "claude-haiku-4-5", spans[0]["gen_ai.request.model"])
	})

	t.Run("never double-prefixes an already-prefixed model", func(t *testing.T) {
		assert.Equal(t, "openai_codex/gpt-5.6-terra",
			canonicalModelID(domain.ProviderID("openai_codex"), "openai_codex/gpt-5.6-terra"))
	})

	t.Run("reports an empty model as empty", func(t *testing.T) {
		assert.Equal(t, "", canonicalModelID(domain.ProviderAnthropic, ""))
	})
}
