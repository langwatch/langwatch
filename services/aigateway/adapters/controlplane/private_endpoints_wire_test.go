package controlplane

import (
	"context"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ADR-203: the config response carries the organization's private endpoint
// bindings; decode puts them on the bundle config and on every credential.
func TestFetchConfig_PrivateEndpoints(t *testing.T) {
	providers := `"providers":[{"id":"mp_1","type":"custom","credentials":{"api_key":"k"},"base_url":"https://llm.internal.acme.test/v1"},` +
		`{"id":"mp_2","type":"openai","credentials":{"api_key":"k2"}}]`

	t.Run("bindings ride on every credential", func(t *testing.T) {
		srv := &configServer{revision: "1", body: `{` + providers + `,"private_endpoints":` +
			`[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21","10.20.2.34"],"port":443}]}`}
		res, err := srv.start(t).FetchConfig(context.Background(), "vk_acme", "")
		require.NoError(t, err)

		want := []domain.PrivateEndpoint{{
			Hostname:  "llm.internal.acme.test",
			Addresses: []netip.Addr{netip.MustParseAddr("10.20.1.21"), netip.MustParseAddr("10.20.2.34")},
			Port:      443,
		}}
		assert.Equal(t, want, res.Config.PrivateEndpoints)
		require.Len(t, res.Config.Credentials, 2)
		for _, cred := range res.Config.Credentials {
			assert.Equal(t, want, cred.PrivateEndpoints, cred.ID)
		}
	})

	// @scenario "Bindings never apply to LangWatch's own credentials"
	t.Run("bindings never ride on the platform's own credentials", func(t *testing.T) {
		platform := `"providers":[{"id":"mp_1","type":"custom","credentials":{"api_key":"k"},"base_url":"https://llm.internal.acme.test/v1"},` +
			`{"id":"platform-openai","type":"openai","credentials":{"api_key":"lw"}},` +
			`{"id":"mp_lw","type":"langwatch","credentials":{"api_key":"lw2"}}]`
		srv := &configServer{revision: "1", body: `{` + platform + `,"private_endpoints":` +
			`[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21"],"port":443}]}`}
		res, err := srv.start(t).FetchConfig(context.Background(), "vk_acme", "")
		require.NoError(t, err)
		require.Len(t, res.Config.Credentials, 3)
		byID := map[string]domain.Credential{}
		for _, cred := range res.Config.Credentials {
			byID[cred.ID] = cred
		}
		assert.Len(t, byID["mp_1"].PrivateEndpoints, 1, "the organization's own credential is bound")
		assert.Empty(t, byID["platform-openai"].PrivateEndpoints, "a platform key is never bound")
		assert.Empty(t, byID["mp_lw"].PrivateEndpoints, "a call to LangWatch is never bound")
		assert.Len(t, res.Config.PrivateEndpoints, 1)
	})

	for name, field := range map[string]string{
		"absent": ``,
		"null":   `,"private_endpoints":null`,
		"empty":  `,"private_endpoints":[]`,
	} {
		t.Run(name+" means no bindings", func(t *testing.T) {
			srv := &configServer{revision: "1", body: `{` + providers + field + `}`}
			res, err := srv.start(t).FetchConfig(context.Background(), "vk_acme", "")
			require.NoError(t, err)
			assert.Empty(t, res.Config.PrivateEndpoints)
			for _, cred := range res.Config.Credentials {
				assert.Empty(t, cred.PrivateEndpoints)
			}
		})
	}

	for name, field := range map[string]string{
		"not an array":         `{"hostname":"llm.internal.acme.test"}`,
		"an IP-literal name":   `[{"hostname":"10.20.1.21","addresses":["10.20.1.21"],"port":443}]`,
		"a CIDR address":       `[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.0/24"],"port":443}]`,
		"an out-of-range port": `[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21"],"port":70000}]`,
	} {
		t.Run("a malformed list fails the fetch: "+name, func(t *testing.T) {
			srv := &configServer{revision: "1", body: `{` + providers + `,"private_endpoints":` + field + `}`}
			_, err := srv.start(t).FetchConfig(context.Background(), "vk_acme", "")
			require.Error(t, err, "a malformed list must not decode to no bindings")
			assert.Contains(t, err.Error(), "private_endpoints")
		})
	}
}
