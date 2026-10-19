package customertracebridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// A read-only (unattended) Langy turn reads one person's trace text with
// nobody watching, so none of it is copied into LangWatch's mirror project.
// Its virtual key is the same Langy key a chat turn uses, so the key's tier
// still says content: the relay withholds the mirror per call instead. The
// call stays a Langy call: it keeps Langy's origin on the customer's span.
func TestMirrorLeg_WithheldForAReadOnlyTurn(t *testing.T) {
	// @scenario "A read-only run's model calls never reach the mirror"
	t.Run("given a Langy call at the content tier whose turn withholds the mirror", func(t *testing.T) {
		p := baseParams()
		p.MirrorTier = mirrorTierContent
		p.MirrorSourceOrgID = "org-acme"
		byProject := emitOneIn(t, armedMirror(), p, WithMirrorWithheld).spansByProject(t)

		require.Len(t, byProject["proj-customer"], 1, "the customer keeps their own span")
		assert.Equal(t, OriginLangy, byProject["proj-customer"][0][otelsetup.AttrLangWatchOrigin],
			"a withheld mirror must not turn a Langy call into gateway traffic")
		assert.Empty(t, byProject["proj-mirror"], "nothing reaches the mirror project")
		_, marked := byProject["proj-customer"][0][string(attrMirrorTier)]
		assert.False(t, marked, "the customer copy carries no mirror marker")
	})

	t.Run("given the same call whose turn does not withhold the mirror", func(t *testing.T) {
		p := baseParams()
		p.MirrorTier = mirrorTierContent
		byProject := emitOne(t, armedMirror(), p).spansByProject(t)

		require.Len(t, byProject["proj-mirror"], 1, "a chat turn still mirrors")
	})
}

// The withheld mirror changes nothing else a Langy call is recognized by: a
// call that arrived without the turn's traceparent is still dropped.
func TestEndSpan_WithheldMirrorKeepsTheOrphanDrop(t *testing.T) {
	p := baseParams()
	p.MirrorTier = mirrorTierContent
	ingest := emitWith(t, "", p)

	assert.Empty(t, ingest.spansByProject(t)["proj-customer"])
}
