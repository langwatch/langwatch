package providers

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAllowsDialAddressHonoursOnlyExactAllowlistEntries(t *testing.T) {
	t.Parallel()

	policy := newCustomerEndpointPolicy(true, false, []string{"10.0.0.5", "llm.internal", "169.254.169.254"})

	for _, test := range []struct {
		name      string
		address   string
		dialHost  string
		wantError bool
	}{
		{name: "allowlisted exact IP", address: "10.0.0.5:443", dialHost: "10.0.0.5"},
		{name: "allowlisted exact IP dialed through an unlisted name", address: "10.0.0.5:443", dialHost: "other.internal"},
		{name: "address resolved from an allowlisted host", address: "10.0.0.9:443", dialHost: "llm.internal"},
		{name: "other private IP", address: "10.0.0.6:443", dialHost: "10.0.0.6", wantError: true},
		{name: "private IP from an unlisted host", address: "10.0.0.9:443", dialHost: "evil.example.com", wantError: true},
		{name: "private IP with no dial host", address: "10.0.0.9:443", wantError: true},
		{name: "loopback not listed", address: "127.0.0.1:443", dialHost: "127.0.0.1", wantError: true},
		{name: "metadata even when listed", address: "169.254.169.254:80", dialHost: "169.254.169.254", wantError: true},
		{name: "metadata resolved from an allowlisted host", address: "169.254.169.254:80", dialHost: "llm.internal", wantError: true},
		{name: "Azure metadata from an allowlisted host", address: "168.63.129.16:80", dialHost: "llm.internal", wantError: true},
		{name: "public IP", address: "8.8.8.8:443", dialHost: "dns.google"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := policy.allowsDialAddress(test.address, test.dialHost)
			if test.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestPolicyDialerConnectsToAnAllowlistedPrivateHostOnly(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	target, err := url.Parse(server.URL)
	require.NoError(t, err)

	allowed := newRealtimeClient(newCustomerEndpointPolicy(true, false, []string{target.Hostname()}))
	resp, err := allowed.Get(server.URL)
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)

	refused := newRealtimeClient(newCustomerEndpointPolicy(true, false, []string{"10.0.0.5"}))
	_, err = refused.Get(server.URL)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "non-public address")
}
