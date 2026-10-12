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

// Without GATEWAY_POD_IP there is no pod address to put in an id, so no peer
// can hop here. Binding :5564 anyway would take a port that npx langwatch
// hands to another service, for nothing.
//
// @scenario "A gateway without a pod address registers no hop listener"
func TestServe_HopServer_NoPodAddressMeansNoHopListener(t *testing.T) {
	hub := mediarelay.NewHub(mediarelay.Options{Secret: "serve-test-secret"})

	srv := hopServer(&Deps{MediaRelay: hub}, Config{RelayHopAddr: ":5564"})

	t.Run("no server is built", func(t *testing.T) { assert.Nil(t, srv) })
	t.Run("no relay-hop service is registered", func(t *testing.T) {
		g := lifecycle.New()
		addManagedServices(g, &Deps{MediaRelay: hub}, ownServices{HTTP: unstartedServer(), Hop: srv})

		assert.NotContains(t, g.ServiceNames(), "relay-hop")
	})
}

// @scenario "A gateway with a pod address serves the hop on the hop address"
func TestServe_HopServer_PodAddressMeansAHopListenerOnTheHopAddress(t *testing.T) {
	hub := mediarelay.NewHub(mediarelay.Options{Secret: "serve-test-secret", PodIP: "10.1.2.3"})

	srv := hopServer(&Deps{MediaRelay: hub}, Config{PodIP: "10.1.2.3", RelayHopAddr: "0.0.0.0:6000"})

	require.NotNil(t, srv)
	assert.Equal(t, "0.0.0.0:6000", srv.Addr)
}

// @scenario "The hop listener never has an empty address"
func TestServe_HopServer_NeverHasAnEmptyAddress(t *testing.T) {
	hub := mediarelay.NewHub(mediarelay.Options{Secret: "serve-test-secret", PodIP: "10.1.2.3"})

	srv := hopServer(&Deps{MediaRelay: hub}, Config{PodIP: "10.1.2.3"})

	if srv != nil {
		assert.NotEmpty(t, srv.Addr, "an empty address would bind a random port")
	}
}

// @scenario "The hop listener never has an empty address"
func TestDefaultConfig_HopAddressIsSetHere(t *testing.T) {
	assert.Equal(t, ":5564", defaultConfig().RelayHopAddr)
}

// A gateway without a media relay has nothing for a hop to reach.
//
// @scenario "A gateway without a hop listener registers none"
func TestServe_HopServer_NoMediaRelayMeansNoHopListener(t *testing.T) {
	assert.Nil(t, hopServer(&Deps{}, Config{PodIP: "10.1.2.3", RelayHopAddr: ":5564"}))
}
