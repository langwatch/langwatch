package domain

import (
	"context"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const acmeBindings = `[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21","10.20.2.34"],"port":443}]`

func TestParsePrivateEndpoints(t *testing.T) {
	t.Run("decodes the wire shape", func(t *testing.T) {
		eps, err := ParsePrivateEndpoints([]byte(acmeBindings))
		require.NoError(t, err)
		require.Len(t, eps, 1)
		assert.Equal(t, "llm.internal.acme.test", eps[0].Hostname)
		assert.Equal(t, 443, eps[0].Port)
		assert.Equal(t, []netip.Addr{netip.MustParseAddr("10.20.1.21"), netip.MustParseAddr("10.20.2.34")}, eps[0].Addresses)
	})

	t.Run("normalizes the hostname", func(t *testing.T) {
		eps, err := ParsePrivateEndpoints([]byte(`[{"hostname":"LLM.Internal.Acme.Test.","addresses":["10.20.1.21"],"port":443}]`))
		require.NoError(t, err)
		assert.Equal(t, "llm.internal.acme.test", eps[0].Hostname)
	})

	for _, empty := range []string{"", "  ", "null", "[]"} {
		t.Run("absent or empty means no bindings: "+empty, func(t *testing.T) {
			eps, err := ParsePrivateEndpoints([]byte(empty))
			require.NoError(t, err)
			assert.Empty(t, eps)
		})
	}

	malformed := []struct {
		name string
		raw  string
	}{
		{"not JSON", `{`},
		{"an object", `{"hostname":"a.test"}`},
		{"wrong types", `[{"hostname":"a.test","addresses":"10.0.0.1","port":443}]`},
		{"empty hostname", `[{"hostname":"","addresses":["10.0.0.1"],"port":443}]`},
		{"IPv4 literal hostname", `[{"hostname":"10.20.1.21","addresses":["10.0.0.1"],"port":443}]`},
		{"IPv6 literal hostname", `[{"hostname":"[fd00::1]","addresses":["10.0.0.1"],"port":443}]`},
		{"wildcard hostname", `[{"hostname":"*.acme.test","addresses":["10.0.0.1"],"port":443}]`},
		{"hostname with port", `[{"hostname":"a.test:443","addresses":["10.0.0.1"],"port":443}]`},
		{"no addresses", `[{"hostname":"a.test","addresses":[],"port":443}]`},
		{"CIDR address", `[{"hostname":"a.test","addresses":["10.20.1.0/24"],"port":443}]`},
		{"hostname address", `[{"hostname":"a.test","addresses":["b.test"],"port":443}]`},
		{"zoned address", `[{"hostname":"a.test","addresses":["fe80::1%eth0"],"port":443}]`},
		{"port zero", `[{"hostname":"a.test","addresses":["10.0.0.1"],"port":0}]`},
		{"port too large", `[{"hostname":"a.test","addresses":["10.0.0.1"],"port":70000}]`},
		{"a LangWatch domain", `[{"hostname":"langwatch.ai","addresses":["10.0.0.1"],"port":443}]`},
		{"a name under a LangWatch domain", `[{"hostname":"app.LangWatch.ai.","addresses":["10.0.0.1"],"port":443}]`},
		{"duplicate hostname", `[{"hostname":"a.test","addresses":["10.0.0.1"],"port":443},{"hostname":"A.test","addresses":["10.0.0.2"],"port":443}]`},
	}
	for _, tc := range malformed {
		t.Run("refuses "+tc.name, func(t *testing.T) {
			_, err := ParsePrivateEndpoints([]byte(tc.raw))
			require.Error(t, err)
			assert.ErrorIs(t, err, ErrPrivateEndpointsMalformed)
		})
	}

	t.Run("an address error does not echo the value", func(t *testing.T) {
		_, err := ParsePrivateEndpoints([]byte(`[{"hostname":"a.test","addresses":["10.20.9.9/32"],"port":443}]`))
		require.Error(t, err)
		assert.NotContains(t, err.Error(), "10.20.9.9")
	})
}

func TestPrivateEndpointFor(t *testing.T) {
	eps, err := ParsePrivateEndpoints([]byte(acmeBindings))
	require.NoError(t, err)

	_, bound := PrivateEndpointFor(eps, "LLM.internal.acme.test.")
	assert.True(t, bound, "a bound host matches case-insensitively and without the trailing dot")

	_, bound = PrivateEndpointFor(eps, "other.acme.test")
	assert.False(t, bound)

	_, bound = PrivateEndpointFor(nil, "llm.internal.acme.test")
	assert.False(t, bound, "another organization's call carries no bindings")

	// A list that somehow names an IP literal still never binds it.
	literal := []PrivateEndpoint{{Hostname: "10.20.1.21", Addresses: []netip.Addr{netip.MustParseAddr("10.20.1.21")}, Port: 443}}
	_, bound = PrivateEndpointFor(literal, "10.20.1.21")
	assert.False(t, bound, "an IP literal is never bound")
}

func TestPrivateEndpointsContext(t *testing.T) {
	eps, err := ParsePrivateEndpoints([]byte(acmeBindings))
	require.NoError(t, err)
	ctx := WithPrivateEndpoints(context.Background(), eps)
	assert.Equal(t, eps, PrivateEndpointsFromContext(ctx))
	assert.Nil(t, PrivateEndpointsFromContext(context.Background()))
}
