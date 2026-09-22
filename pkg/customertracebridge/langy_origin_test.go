package customertracebridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// A Langy turn's model call is Langy's, and the gateway's retold span is the
// first piece of the turn to reach the customer's project. The span names the
// origin itself so the trace reads as Langy's from its first span, before the
// worker spans and the langy.turn root land. Ordinary gateway traffic keeps the
// gateway's own origin, which the resource carries.
func TestEndSpan_LangyCallNamesItsOriginOnTheSpan(t *testing.T) {
	const turnTraceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

	// @scenario "A Langy turn's model call is Langy's from its first span"
	t.Run("given a Langy call carrying the turn's traceparent", func(t *testing.T) {
		p := baseParams()
		p.MirrorTier = mirrorTierContent
		spans := emitWith(t, turnTraceparent, p).spansByProject(t)["proj-customer"]

		require.Len(t, spans, 1, "the joined span must be exported")
		assert.Equal(t, OriginLangy, spans[0][otelsetup.AttrLangWatchOrigin],
			"the retold span must carry Langy's origin, so the first span to fold settles the trace as Langy's")
	})

	t.Run("given a Langy call at the structural tier", func(t *testing.T) {
		p := baseParams()
		p.MirrorTier = mirrorTierStructural
		spans := emitWith(t, turnTraceparent, p).spansByProject(t)["proj-customer"]

		require.Len(t, spans, 1)
		assert.Equal(t, OriginLangy, spans[0][otelsetup.AttrLangWatchOrigin])
	})

	// @scenario "Gateway traffic outside a Langy turn keeps its own trace"
	t.Run("given ordinary gateway traffic", func(t *testing.T) {
		spans := emitWith(t, "", baseParams()).spansByProject(t)["proj-customer"]

		require.Len(t, spans, 1)
		_, stamped := spans[0][otelsetup.AttrLangWatchOrigin]
		assert.False(t, stamped,
			"a customer's own call through the gateway must not be relabeled as Langy's")
	})
}
