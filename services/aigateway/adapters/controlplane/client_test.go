package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/jwtverify"
)

func TestFetchConfig_EscapesVKID(t *testing.T) {
	tests := []struct {
		name    string
		vkID    string
		wantURI string
	}{
		{
			name:    "normal id",
			vkID:    "vk-abc123",
			wantURI: "/api/internal/gateway/config/vk-abc123",
		},
		{
			name:    "path traversal attempt",
			vkID:    "../../admin/secrets",
			wantURI: "/api/internal/gateway/config/..%2F..%2Fadmin%2Fsecrets",
		},
		{
			name:    "query injection attempt",
			vkID:    "test?admin=1",
			wantURI: "/api/internal/gateway/config/test%3Fadmin=1",
		},
		{
			name:    "fragment injection",
			vkID:    "test#fragment",
			wantURI: "/api/internal/gateway/config/test%23fragment",
		},
		{
			name:    "slashes in id",
			vkID:    "a/b/c",
			wantURI: "/api/internal/gateway/config/a%2Fb%2Fc",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var capturedURI string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				capturedURI = r.RequestURI
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{}`))
			}))
			defer srv.Close()

			signer, err := NewSigner("test-secret", "node-1")
			require.NoError(t, err)
			verifier := jwtverify.NewJWTVerifier("jwt-secret", "")
			cp := NewClient(ClientOptions{
				BaseURL:    srv.URL,
				Sign:       signer.Sign,
				Verifier:   verifier,
				HTTPClient: srv.Client(),
			})

			_, _ = cp.FetchConfig(context.Background(), tt.vkID, "")

			assert.Equal(t, tt.wantURI, capturedURI)
		})
	}
}

// configServer is a stand-in for the control plane's §4.2 config endpoint: it
// answers 304 when the request's If-None-Match matches the revision it is
// currently serving, and 200 with that revision as the ETag otherwise. Same
// contract as gateway-internal.ts, which keys the ETag off VirtualKey.revision.
type configServer struct {
	revision string
	// omitETag drops the ETag header from the 200, the way a proxy that strips
	// it would, so the caller has nothing to revalidate with next time.
	omitETag       bool
	requestHeaders []string
}

func (s *configServer) start(t *testing.T) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ifNoneMatch := r.Header.Get("If-None-Match")
		s.requestHeaders = append(s.requestHeaders, ifNoneMatch)
		if ifNoneMatch != "" && ifNoneMatch == s.revision {
			w.Header().Set("ETag", s.revision)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		if !s.omitETag {
			w.Header().Set("ETag", s.revision)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"models_allowed":["openai/gpt-5-mini"]}`))
	}))
	t.Cleanup(srv.Close)

	return NewClient(ClientOptions{
		BaseURL:    srv.URL,
		Sign:       func(_ *http.Request, _ []byte) {},
		HTTPClient: srv.Client(),
	})
}

func TestFetchConfig_Conditional(t *testing.T) {
	t.Run("when the caller has no ETag yet", func(t *testing.T) {
		srv := &configServer{revision: "42"}
		cp := srv.start(t)

		res, err := cp.FetchConfig(context.Background(), "vk_acme", "")

		require.NoError(t, err)
		assert.False(t, res.NotModified, "an unconditional fetch has nothing to confirm")
		assert.Equal(t, "42", res.ETag, "the version token has to come back for the next fetch to use")
		assert.Equal(t, []string{"openai/gpt-5-mini"}, res.Config.AllowedModels)
		assert.Equal(t, []string{""}, srv.requestHeaders, "nothing to send when we hold no ETag")
	})

	t.Run("when the caller sends the ETag it already holds", func(t *testing.T) {
		srv := &configServer{revision: "42"}
		cp := srv.start(t)

		first, err := cp.FetchConfig(context.Background(), "vk_acme", "")
		require.NoError(t, err)
		second, err := cp.FetchConfig(context.Background(), "vk_acme", first.ETag)

		require.NoError(t, err)
		assert.Equal(t, []string{"", "42"}, srv.requestHeaders,
			"the second fetch has to offer the revision the first one came back with")
		assert.True(t, second.NotModified, "an unchanged key is confirmed, not re-downloaded")
		assert.Equal(t, "42", second.ETag, "the confirmed token stays usable for the fetch after this one")
		assert.Empty(t, second.Config.AllowedModels, "a 304 carries no config; the caller keeps the one it has")
	})

	t.Run("when the key changed since the caller's ETag", func(t *testing.T) {
		srv := &configServer{revision: "43"}
		cp := srv.start(t)

		res, err := cp.FetchConfig(context.Background(), "vk_acme", "42")

		require.NoError(t, err)
		assert.False(t, res.NotModified, "a revision the control plane has moved past is not current")
		assert.Equal(t, "43", res.ETag, "the new revision replaces the one we offered")
		assert.Equal(t, []string{"openai/gpt-5-mini"}, res.Config.AllowedModels)
	})

	t.Run("when the response carries no ETag", func(t *testing.T) {
		srv := &configServer{revision: "42", omitETag: true}
		cp := srv.start(t)

		first, err := cp.FetchConfig(context.Background(), "vk_acme", "")
		require.NoError(t, err)
		require.Empty(t, first.ETag, "there is no token to remember")

		second, err := cp.FetchConfig(context.Background(), "vk_acme", first.ETag)

		require.NoError(t, err)
		assert.Equal(t, []string{"", ""}, srv.requestHeaders,
			"with no token to offer, the next fetch goes out unconditional rather than inventing one")
		assert.False(t, second.NotModified)
		assert.Equal(t, []string{"openai/gpt-5-mini"}, second.Config.AllowedModels)
	})

	t.Run("when the control plane answers 304 to an unconditional fetch", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNotModified)
		}))
		t.Cleanup(srv.Close)
		cp := NewClient(ClientOptions{
			BaseURL:    srv.URL,
			Sign:       func(_ *http.Request, _ []byte) {},
			HTTPClient: srv.Client(),
		})

		_, err := cp.FetchConfig(context.Background(), "vk_acme", "")

		// Nothing was offered, so there is nothing a 304 could be confirming.
		// Reporting it as "still current" would hand the caller a config it
		// does not have and call it fresh.
		require.Error(t, err)
		assert.Contains(t, err.Error(), "304")
	})
}
