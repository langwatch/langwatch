package providers

import (
	"context"
	"encoding/base64"
	"errors"
	"net"
	"net/netip"
	"strings"
	"sync"
	"syscall"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Scenarios: specs/security/org-private-model-endpoints.feature (@unit).

var acmeAddresses = []string{"10.20.1.21", "10.20.2.34"}

func acmeBinding(addresses ...string) domain.PrivateEndpoint {
	if len(addresses) == 0 {
		addresses = acmeAddresses
	}
	addrs := make([]netip.Addr, 0, len(addresses))
	for _, a := range addresses {
		addrs = append(addrs, netip.MustParseAddr(a))
	}
	return domain.PrivateEndpoint{Hostname: "llm.internal.acme.test", Addresses: addrs, Port: 443}
}

// refusingResolver fails the test if a lookup happens: a bound hostname must
// never be resolved.
func refusingResolver(t *testing.T) endpointResolver {
	return func(_ context.Context, host string) ([]net.IP, error) {
		t.Errorf("unexpected DNS lookup for %q", host)
		return nil, errors.New("lookup refused by test")
	}
}

func assertNoRegisteredAddress(t *testing.T, err error, addresses ...string) {
	t.Helper()
	require.Error(t, err)
	for _, a := range append(addresses, acmeAddresses...) {
		assert.NotContains(t, err.Error(), a, "a refusal must not reveal a registered address")
	}
}

func customCred(baseURL string, eps ...domain.PrivateEndpoint) domain.Credential {
	return domain.Credential{
		ID:               "mp_acme",
		ProviderID:       domain.ProviderCustom,
		APIKey:           "sk-acme",
		Extra:            map[string]string{"base_url": baseURL},
		PrivateEndpoints: eps,
	}
}

func TestValidateCredentialEndpointsWithPrivateEndpoints(t *testing.T) {
	t.Parallel()

	t.Run("a bound hostname is never resolved", func(t *testing.T) {
		t.Parallel()
		// Public DNS would answer 203.0.113.10; the resolver is never asked.
		policy := policyWithResolver(true, nil, refusingResolver(t))
		policy.requireHTTPS = true
		err := validateCredentialEndpoints(t.Context(), customCred("https://llm.internal.acme.test/v1", acmeBinding()), policy)
		require.NoError(t, err)
	})

	t.Run("an explicit default port is the binding's port", func(t *testing.T) {
		t.Parallel()
		policy := policyWithResolver(true, nil, refusingResolver(t))
		err := validateCredentialEndpoints(t.Context(), customCred("https://LLM.internal.acme.test.:443/v1", acmeBinding()), policy)
		require.NoError(t, err)
	})

	refused := []struct {
		name    string
		baseURL string
		binding domain.PrivateEndpoint
		names   []string
	}{
		{"http on a bound hostname", "http://llm.internal.acme.test/v1", acmeBinding(), []string{"llm.internal.acme.test", "https"}},
		{"another port on a bound hostname", "https://llm.internal.acme.test:8443/v1", acmeBinding(), []string{"llm.internal.acme.test", "8443"}},
		{"a binding carrying a metadata address", "https://llm.internal.acme.test/v1", acmeBinding("10.20.1.21", "169.254.169.254"), []string{"llm.internal.acme.test"}},
		{"a binding carrying IPv6 metadata", "https://llm.internal.acme.test/v1", acmeBinding("fd00:ec2::254"), []string{"llm.internal.acme.test"}},
		{"a binding carrying shared-space metadata", "https://llm.internal.acme.test/v1", acmeBinding("100.100.100.200"), []string{"llm.internal.acme.test"}},
		{"a binding carrying loopback", "https://llm.internal.acme.test/v1", acmeBinding("127.0.0.1"), []string{"llm.internal.acme.test"}},
		{"a binding carrying a public address", "https://llm.internal.acme.test/v1", acmeBinding("8.8.8.8"), []string{"llm.internal.acme.test"}},
		{"a binding carrying link-local", "https://llm.internal.acme.test/v1", acmeBinding("169.254.10.1"), []string{"llm.internal.acme.test"}},
		{"a binding carrying the unspecified address", "https://llm.internal.acme.test/v1", acmeBinding("0.0.0.0"), []string{"llm.internal.acme.test"}},
	}
	for _, tc := range refused {
		t.Run("refuses "+tc.name, func(t *testing.T) {
			t.Parallel()
			policy := policyWithResolver(true, nil, refusingResolver(t))
			err := validateCredentialEndpoints(t.Context(), customCred(tc.baseURL, tc.binding), policy)
			var addrs []string
			for _, a := range tc.binding.Addresses {
				addrs = append(addrs, a.String())
			}
			assertNoRegisteredAddress(t, err, addrs...)
			for _, want := range tc.names {
				assert.Contains(t, err.Error(), want)
			}
		})
	}

	t.Run("an IP-literal base URL is never treated as bound", func(t *testing.T) {
		t.Parallel()
		literal := acmeBinding()
		literal.Hostname = "10.20.1.21"
		policy := policyWithResolver(true, nil, refusingResolver(t))
		err := validateCredentialEndpoints(t.Context(), customCred("https://10.20.1.21/v1", acmeBinding(), literal), policy)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "non-public address")
	})

	t.Run("another organization's call resolves as usual and a private answer is refused", func(t *testing.T) {
		t.Parallel()
		lookups := 0
		policy := policyWithResolver(true, nil, func(context.Context, string) ([]net.IP, error) {
			lookups++
			return []net.IP{net.ParseIP("10.20.1.21")}, nil
		})
		// Rival's credential carries Rival's bindings: none.
		err := validateCredentialEndpoints(t.Context(), customCred("https://llm.internal.acme.test/v1"), policy)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "non-public address")
		assert.Equal(t, 1, lookups)
	})

	t.Run("a binding for another hostname leaves this one on today's rules", func(t *testing.T) {
		t.Parallel()
		other := acmeBinding()
		other.Hostname = "other.acme.test"
		policy := policyWithResolver(true, nil, staticResolver("10.0.0.9"))
		err := validateCredentialEndpoints(t.Context(), customCred("https://llm.internal.acme.test/v1", other), policy)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "non-public address")
	})

	t.Run("with BLOCK_LOCAL_HTTP_CALLS false an unbound private host is allowed", func(t *testing.T) {
		t.Parallel()
		policy := policyWithResolver(false, nil, refusingResolver(t))
		err := validateCredentialEndpoints(t.Context(), customCred("https://10.0.5.3/v1"), policy)
		require.NoError(t, err)
	})

	t.Run("metadata hostnames cannot be bound", func(t *testing.T) {
		t.Parallel()
		meta := acmeBinding()
		meta.Hostname = "metadata.google.internal"
		policy := policyWithResolver(false, nil, refusingResolver(t))
		err := validateCredentialEndpoints(t.Context(), customCred("https://metadata.google.internal/v1", meta), policy)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "reserved for cloud metadata")
	})

	t.Run("a provider that cannot be pinned is refused, not resolved", func(t *testing.T) {
		t.Parallel()
		policy := policyWithResolver(true, nil, refusingResolver(t))
		azure := domain.Credential{
			ID: "mp_azure", ProviderID: domain.ProviderAzure, APIKey: "k",
			Extra:            map[string]string{"endpoint": "https://llm.internal.acme.test"},
			PrivateEndpoints: []domain.PrivateEndpoint{acmeBinding()},
		}
		err := validateCredentialEndpoints(t.Context(), azure, policy)
		assertNoRegisteredAddress(t, err)
		assert.Contains(t, err.Error(), "cannot use")
	})
}

func TestPrivateEndpointAddressAllowed(t *testing.T) {
	t.Parallel()
	for addr, want := range map[string]bool{
		"10.20.1.21":        true,
		"172.16.0.5":        true,
		"192.168.3.4":       true,
		"100.64.1.1":        true,
		"fd12:3456::1":      true,
		"::ffff:10.20.1.21": true,
		"169.254.169.254":   false,
		"169.254.170.2":     false,
		"100.100.100.200":   false,
		"fd00:ec2::254":     false,
		"127.0.0.1":         false,
		"::1":               false,
		"0.0.0.0":           false,
		"8.8.8.8":           false,
		"203.0.113.10":      false,
		"fe80::1":           false,
		"224.0.0.1":         false,
	} {
		assert.Equal(t, want, privateEndpointAddressAllowed(netip.MustParseAddr(addr), false), addr)
	}
	assert.True(t, privateEndpointAddressAllowed(netip.MustParseAddr("127.0.0.1"), true), "the test seam admits loopback")
	assert.False(t, privateEndpointAddressAllowed(netip.MustParseAddr("169.254.169.254"), true), "never metadata, seam or not")
}

// recordingDial is a fake connect step: it records every address tried and
// refuses the ones listed.
type recordingDial struct {
	mu      sync.Mutex
	tried   []string
	refused map[string]bool
}

func (d *recordingDial) dial(_ context.Context, _, address string) (net.Conn, error) {
	d.mu.Lock()
	d.tried = append(d.tried, address)
	d.mu.Unlock()
	if d.refused[address] {
		return nil, &net.OpError{Op: "dial", Net: "tcp", Err: syscall.ECONNREFUSED,
			Addr: &net.TCPAddr{IP: net.ParseIP(strings.Split(address, ":")[0]), Port: 443}}
	}
	client, server := net.Pipe()
	_ = server.Close()
	return client, nil
}

func TestPrivateEndpointDialer(t *testing.T) {
	t.Parallel()

	t.Run("dials the first registered address without a lookup", func(t *testing.T) {
		t.Parallel()
		rec := &recordingDial{}
		d := privateEndpointDialer{dial: rec.dial}
		conn, err := d.DialEndpoint(t.Context(), acmeBinding(), "llm.internal.acme.test:443")
		require.NoError(t, err)
		_ = conn.Close()
		assert.Equal(t, []string{"10.20.1.21:443"}, rec.tried)
	})

	t.Run("tries the second address when the first refuses", func(t *testing.T) {
		t.Parallel()
		rec := &recordingDial{refused: map[string]bool{"10.20.1.21:443": true}}
		d := privateEndpointDialer{dial: rec.dial}
		conn, err := d.DialEndpoint(t.Context(), acmeBinding(), "llm.internal.acme.test:443")
		require.NoError(t, err)
		_ = conn.Close()
		assert.Equal(t, []string{"10.20.1.21:443", "10.20.2.34:443"}, rec.tried)
	})

	t.Run("a connect failure names the hostname and port, not the addresses", func(t *testing.T) {
		t.Parallel()
		rec := &recordingDial{refused: map[string]bool{"10.20.1.21:443": true, "10.20.2.34:443": true}}
		d := privateEndpointDialer{dial: rec.dial}
		_, err := d.DialEndpoint(t.Context(), acmeBinding(), "llm.internal.acme.test:443")
		assertNoRegisteredAddress(t, err)
		assert.Contains(t, err.Error(), "llm.internal.acme.test:443")
		assert.True(t, errors.Is(err, syscall.ECONNREFUSED), "the cause stays inspectable for logs")
	})

	refusedTargets := map[string]string{
		"another port":     "llm.internal.acme.test:8443",
		"another hostname": "evil.acme.test:443",
		"an IP literal":    "10.20.1.21:443",
		"not host:port":    "llm.internal.acme.test",
	}
	for name, target := range refusedTargets {
		t.Run("refuses "+name+" before connecting", func(t *testing.T) {
			t.Parallel()
			rec := &recordingDial{}
			d := privateEndpointDialer{dial: rec.dial}
			_, err := d.DialEndpoint(t.Context(), acmeBinding(), target)
			assertNoRegisteredAddress(t, err)
			assert.Empty(t, rec.tried, "no connection is opened")
		})
	}

	for _, bad := range []string{"169.254.169.254", "127.0.0.1", "8.8.8.8"} {
		t.Run("refuses a binding carrying "+bad, func(t *testing.T) {
			t.Parallel()
			rec := &recordingDial{}
			d := privateEndpointDialer{dial: rec.dial}
			_, err := d.DialEndpoint(t.Context(), acmeBinding("10.20.1.21", bad), "llm.internal.acme.test:443")
			assertNoRegisteredAddress(t, err, bad)
			assert.Empty(t, rec.tried, "a corrupt binding opens nothing, not even its good address")
		})
	}
}

func TestPinnedProvider(t *testing.T) {
	t.Parallel()
	r := &BifrostRouter{anthropicCompat: newAnthropicCompatRegistry(anthropicCompatMaxEndpoints)}

	t.Run("an unbound credential keeps its provider", func(t *testing.T) {
		assert.Equal(t, bfschemas.VLLM, r.pinnedProvider(customCred("https://llm.internal.acme.test/v1"), bfschemas.VLLM))
	})

	t.Run("a bound OpenAI-compatible credential gets its own OpenAI-type provider", func(t *testing.T) {
		cred := customCred("https://llm.internal.acme.test/v1", acmeBinding())
		key := r.pinnedProvider(cred, bfschemas.VLLM)
		require.True(t, isPrivateEndpointProvider(key), key)
		endpoint, ok := r.anthropicCompat.lookup(string(key))
		require.True(t, ok)
		assert.Equal(t, bfschemas.OpenAI, endpoint.baseType)
		assert.Equal(t, "https://llm.internal.acme.test", endpoint.baseURL)
		require.NotNil(t, endpoint.pin)
		assert.Equal(t, acmeBinding(), *endpoint.pin)
		assert.Equal(t, key, r.pinnedProvider(cred, bfschemas.VLLM), "the same binding reuses its provider")
		assert.NotContains(t, string(key), "10.20", "the key does not spell an address")
	})

	t.Run("a bound Anthropic credential keeps the Anthropic wire", func(t *testing.T) {
		cred := customCred("https://llm.internal.acme.test", acmeBinding())
		cred.ProviderID = domain.ProviderAnthropic
		key := r.pinnedProvider(cred, mapProvider(cred))
		endpoint, ok := r.anthropicCompat.lookup(string(key))
		require.True(t, ok)
		assert.Equal(t, bfschemas.Anthropic, endpoint.baseType)
	})

	t.Run("two organizations binding one name get separate providers", func(t *testing.T) {
		rival := acmeBinding("10.20.3.5")
		acmeKey := r.pinnedProvider(customCred("https://llm.internal.acme.test/v1", acmeBinding()), bfschemas.VLLM)
		rivalKey := r.pinnedProvider(customCred("https://llm.internal.acme.test/v1", rival), bfschemas.VLLM)
		assert.NotEqual(t, acmeKey, rivalKey, "separate providers mean separate connection pools")
		endpoint, _ := r.anthropicCompat.lookup(string(rivalKey))
		assert.Equal(t, []netip.Addr{netip.MustParseAddr("10.20.3.5")}, endpoint.pin.Addresses)
	})
}

func TestPrivateEndpointProxyAuthentication(t *testing.T) {
	t.Parallel()
	p := newPrivateEndpointProxy(newAnthropicCompatRegistry(4), nil, false)
	key := privateEndpointPrefix + "0123456789abcdef"
	basic := func(user, pass string) string {
		return "Basic " + base64Std(user+":"+pass)
	}
	got, ok := p.authenticate(basic(key, p.password(key)))
	assert.True(t, ok)
	assert.Equal(t, key, got)

	_, ok = p.authenticate(basic(key, "wrong"))
	assert.False(t, ok, "a wrong secret is refused")
	_, ok = p.authenticate(basic("anthropic-url-0123", p.password("anthropic-url-0123")))
	assert.False(t, ok, "only pinned provider keys may tunnel")
	_, ok = p.authenticate("")
	assert.False(t, ok)

	other := newPrivateEndpointProxy(newAnthropicCompatRegistry(4), nil, false)
	_, ok = other.authenticate(basic(key, p.password(key)))
	assert.False(t, ok, "a password is only valid in the process that issued it")
}

func base64Std(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
