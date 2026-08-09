package controlplane

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
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
	omitETag bool

	// mu guards requestHeaders, which the handler goroutine appends to and the
	// test goroutine reads. Do returning is not a documented happens-before
	// against the handler, so the ordering would be net/http's to change.
	mu             sync.Mutex
	requestHeaders []string
}

func (s *configServer) start(t *testing.T) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ifNoneMatch := r.Header.Get("If-None-Match")
		s.mu.Lock()
		s.requestHeaders = append(s.requestHeaders, ifNoneMatch)
		s.mu.Unlock()
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

// conditionals reports the If-None-Match each request carried, in order.
func (s *configServer) conditionals() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.requestHeaders...)
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
		assert.Equal(t, []string{""}, srv.conditionals(), "nothing to send when we hold no ETag")
	})

	t.Run("when the caller sends the ETag it already holds", func(t *testing.T) {
		srv := &configServer{revision: "42"}
		cp := srv.start(t)

		first, err := cp.FetchConfig(context.Background(), "vk_acme", "")
		require.NoError(t, err)
		second, err := cp.FetchConfig(context.Background(), "vk_acme", first.ETag)

		require.NoError(t, err)
		assert.Equal(t, []string{"", "42"}, srv.conditionals(),
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
		assert.Equal(t, []string{"", ""}, srv.conditionals(),
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

/** @scenario "an answer the gateway cannot read is a failed refresh, not an empty config" */
func TestFetchConfig_UnreadableBody_IsAnError(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{"truncated json", `{"models_allowed":["openai/gpt-5-mini"`},
		{"not json at all", `<html>502 Bad Gateway</html>`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("ETag", "42")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(tc.body))
			}))
			t.Cleanup(srv.Close)
			cp := NewClient(ClientOptions{
				BaseURL:    srv.URL,
				Sign:       func(_ *http.Request, _ []byte) {},
				HTTPClient: srv.Client(),
			})

			res, err := cp.FetchConfig(context.Background(), "vk_acme", "41")

			// A 200 the gateway cannot parse is a failure, never an empty
			// config: handing one back would let the caller cache a key with
			// no credentials over the working config it already holds.
			require.Error(t, err)
			assert.Empty(t, res.Config.Credentials)
			assert.Empty(t, res.ETag, "a token from an unreadable answer must not be stored")
			assert.False(t, res.NotModified)
		})
	}

	// The nastier shape: the bytes that arrived are complete, valid JSON, and
	// the stream still failed. Parsing succeeds, so only the read error says
	// the config is short of whatever the control plane meant to send.
	t.Run("valid json cut short of its Content-Length", func(t *testing.T) {
		full := `{"models_allowed":["openai/gpt-5-mini"],"providers_allowed":["mp_1"]}`
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("ETag", "42")
			w.Header().Set("Content-Type", "application/json")
			// Promise more than gets written, then return: the connection
			// closes early and the client's read ends in ErrUnexpectedEOF.
			w.Header().Set("Content-Length", strconv.Itoa(len(full)+64))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(full))
		}))
		t.Cleanup(srv.Close)
		cp := NewClient(ClientOptions{
			BaseURL:    srv.URL,
			Sign:       func(_ *http.Request, _ []byte) {},
			HTTPClient: srv.Client(),
		})

		res, err := cp.FetchConfig(context.Background(), "vk_acme", "41")

		require.Error(t, err, "a truncated body must not pass as config just because it parses")
		require.ErrorIs(t, err, io.ErrUnexpectedEOF)
		assert.Empty(t, res.Config.AllowedModels)
		assert.Empty(t, res.ETag)
		assert.False(t, res.NotModified)
	})
}
