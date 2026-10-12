package mediarelay_test

// Which addresses the hop may dial as the owner of a relay. The owner address
// comes out of an id that the caller of a public route supplies, so a forged
// id must not be able to aim the gateway at an arbitrary host.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"testing"

	"github.com/stretchr/testify/assert"

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
		"a shared address space one":   "100.64.0.1",
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
