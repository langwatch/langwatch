package aigateway

// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
)

// The hop listener has to serve through the whole voice drain: a Twilio socket
// that lands on another pod while this pod drains still hops here. Stop runs in
// reverse registration order, so the hop is registered before the relay hub
// (which waits for its relays to end) and before the public listener.
//
// @scenario "The hop listener stops after the media relay hub and the public listener"
func TestServe_ManagedServices_RelayHopStopsAfterTheHubAndThePublicListener(t *testing.T) {
	g := lifecycle.New()
	hub := mediarelay.NewHub(mediarelay.Options{Secret: "serve-test-secret"})
	addManagedServices(g, &Deps{MediaRelay: hub}, ownServices{HTTP: unstartedServer(), Hop: unstartedServer()})

	started := g.ServiceNames()
	hopAt := slices.Index(started, "relay-hop")
	hubAt := slices.Index(started, "voice-media-relay")
	httpAt := slices.Index(started, "http")

	require.NotEqual(t, -1, hopAt, "the hop listener is not registered, start order was %v", started)
	require.NotEqual(t, -1, hubAt)
	assert.Less(t, hopAt, hubAt, "the hop must stop after the hub, start order was %v", started)
	assert.Less(t, hopAt, httpAt, "the hop must stop after the public listener, start order was %v", started)
}

// @scenario "A gateway without a hop listener registers none"
func TestServe_ManagedServices_NoHopListenerWhenNoneIsGiven(t *testing.T) {
	g := lifecycle.New()
	addManagedServices(g, &Deps{}, ownServices{HTTP: unstartedServer()})

	assert.NotContains(t, g.ServiceNames(), "relay-hop")
}
