package httpblock_test

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

// A proxied request is dialled to the proxy, so the target is checked before
// the proxy is chosen: every hop, redirects included, goes through this.
func viaProxy(*http.Request) (*url.URL, error) {
	return url.Parse("http://proxy.internal:3128")
}

func publicResolver(string) ([]net.IP, error) {
	return []net.IP{net.ParseIP("93.184.216.34")}, nil
}

func proxiedTo(t *testing.T, target string, opts httpblock.SSRFOptions) (*url.URL, error) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, target, nil)
	require.NoError(t, err)
	return httpblock.SafeProxy(opts, viaProxy)(req)
}

func TestSafeProxy_RefusesAPrivateTarget(t *testing.T) {
	_, err := proxiedTo(t, "http://10.0.0.5/admin", httpblock.SSRFOptions{Resolver: publicResolver})
	require.ErrorIs(t, err, httpblock.ErrSSRFBlocked)
}

func TestSafeProxy_RefusesAMetadataTarget(t *testing.T) {
	_, err := proxiedTo(t, "http://169.254.169.254/latest", httpblock.SSRFOptions{Resolver: publicResolver})
	require.ErrorIs(t, err, httpblock.ErrSSRFBlocked)
}

func TestSafeProxy_RefusesATargetOnlyTheProxyCouldResolve(t *testing.T) {
	_, err := proxiedTo(t, "http://internal-only.corp/secret", httpblock.SSRFOptions{
		Resolver: func(string) ([]net.IP, error) { return nil, errors.New("no such host") },
	})
	require.ErrorIs(t, err, httpblock.ErrHostUnresolved)
}

func TestSafeProxy_PassesAPublicTargetToTheProxy(t *testing.T) {
	proxy, err := proxiedTo(t, "http://public.test/x", httpblock.SSRFOptions{Resolver: publicResolver})
	require.NoError(t, err)
	assert.Equal(t, "proxy.internal:3128", proxy.Host)
}

func TestSafeProxy_LeavesADirectRequestToTheDialer(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "http://10.0.0.5/admin", nil)
	require.NoError(t, err)
	direct := func(*http.Request) (*url.URL, error) { return nil, nil }
	proxy, err := httpblock.SafeProxy(httpblock.SSRFOptions{}, direct)(req)
	require.NoError(t, err)
	assert.Nil(t, proxy)
}

func TestSSRF_RefusesAnUnresolvableHost(t *testing.T) {
	for name, resolver := range map[string]func(string) ([]net.IP, error){
		"lookup fails": func(string) ([]net.IP, error) { return nil, errors.New("no such host") },
		"no records":   func(string) ([]net.IP, error) { return nil, nil },
	} {
		t.Run(name, func(t *testing.T) {
			err := httpblock.CheckURL("http://nowhere.test/", httpblock.SSRFOptions{Resolver: resolver})
			require.ErrorIs(t, err, httpblock.ErrHostUnresolved)
		})
	}
}
