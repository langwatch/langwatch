package mediarelay_test

// Which addresses the hop may dial as the owner of a relay. The owner address
// comes out of an id that the caller of a public route supplies, so a forged
// id must not be able to aim the gateway at an arbitrary host.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
)

// @scenario "Only private addresses are dialed as owners"
func TestPrivateOwnerIP_AcceptsTheRangesOfAPodNetwork(t *testing.T) {
	t.Parallel()
	for _, ip := range []string{
		"10.0.0.1", "10.255.255.255",
		"172.16.0.1", "172.31.255.255",
		"192.168.0.1", "192.168.255.255",
		"127.0.0.1", "127.0.0.2", "127.255.255.254",
		"fc00::1", "fd12:3456:789a::1",
		// Shared address space (RFC 6598): the pod range of EKS custom networking.
		"100.64.0.0", "100.64.0.1", "100.100.100.100", "100.127.255.255",
	} {
		t.Run(ip, func(t *testing.T) {
			t.Parallel()
			assert.True(t, mediarelay.PrivateOwnerIP(ip))
		})
	}
}

// @scenario "Only private addresses are dialed as owners"
func TestPrivateOwnerIP_RefusesEverythingElse(t *testing.T) {
	t.Parallel()
	for name, ip := range map[string]string{
		"just below 10/8":              "9.255.255.255",
		"just above 10/8":              "11.0.0.1",
		"just below 172.16/12":         "172.15.255.255",
		"just above 172.16/12":         "172.32.0.1",
		"just below 192.168/16":        "192.167.255.255",
		"just above 192.168/16":        "192.169.0.1",
		"a public address":             "8.8.8.8",
		"a link-local address":         "169.254.169.254",
		"just below 100.64/10":         "100.63.255.255",
		"just above 100.64/10":         "100.128.0.0",
		"the unspecified address":      "0.0.0.0",
		"a broadcast address":          "255.255.255.255",
		"an IPv6 link-local address":   "fe80::1",
		"a public IPv6 address":        "2001:db8::1",
		"the unspecified IPv6 address": "::",
		"an IPv4-mapped public one":    "::ffff:8.8.8.8",
		"an empty string":              "",
		"a host name":                  "localhost",
		"a name that looks private":    "10.0.0.1.example.com",
		"an address with a port":       "10.0.0.1:5564",
		"an address with a path":       "10.0.0.1/x",
		"an address with a space":      "10.0.0.1 ",
		"an address with a zone":       "fd00::1%eth0",
		"an address with leading zero": "010.0.0.1",
		"a bracketed IPv6 address":     "[fd00::1]",
		"an address with userinfo":     "x@10.0.0.1",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			assert.False(t, mediarelay.PrivateOwnerIP(ip), "%q must not be dialed", ip)
		})
	}
}

// The hop client must follow no redirect (the signature would reach another
// host) and use no environment proxy. The proxy half is asserted on the
// transport, because Go never proxies a loopback address.
//
// @scenario "The hop client follows no redirect and uses no proxy"
func TestHopHTTPClient_UsesNoProxy(t *testing.T) {
	t.Parallel()
	client := mediarelay.NewHub(mediarelay.Options{Secret: "hop-client-secret"}).HopHTTPClient()

	require.NotNil(t, client)
	transport, ok := client.Transport.(*http.Transport)
	require.True(t, ok, "the hop client needs its own *http.Transport, got %T", client.Transport)
	assert.Nil(t, transport.Proxy, "the hop dial must not read HTTP_PROXY or HTTPS_PROXY")
}

// @scenario "The hop client follows no redirect and uses no proxy"
func TestHopHTTPClient_FollowsNoRedirect(t *testing.T) {
	t.Parallel()
	client := mediarelay.NewHub(mediarelay.Options{Secret: "hop-client-secret"}).HopHTTPClient()

	require.NotNil(t, client)
	require.NotNil(t, client.CheckRedirect)
	assert.ErrorIs(t, client.CheckRedirect(&http.Request{}, nil), http.ErrUseLastResponse)
}

// One client per hub, so its connections are not rebuilt per dial.
//
// @scenario "The hop client follows no redirect and uses no proxy"
func TestHopHTTPClient_IsOnePerHub(t *testing.T) {
	t.Parallel()
	hub := mediarelay.NewHub(mediarelay.Options{Secret: "hop-client-secret"})

	//nolint:testifylint // two calls returning one pointer is the property under test.
	assert.Same(t, hub.HopHTTPClient(), hub.HopHTTPClient())
}

// A hop is one signed request to one pod, so a kept-alive connection to an
// owner only holds a socket (and an idle pool) for nothing.
//
// @scenario "The hop client follows no redirect and uses no proxy"
func TestHopHTTPClient_KeepsNoConnectionsAlive(t *testing.T) {
	t.Parallel()
	client := mediarelay.NewHub(mediarelay.Options{Secret: "hop-client-secret"}).HopHTTPClient()

	require.NotNil(t, client)
	transport, ok := client.Transport.(*http.Transport)
	require.True(t, ok, "the hop client needs its own *http.Transport, got %T", client.Transport)
	assert.True(t, transport.DisableKeepAlives)
}
