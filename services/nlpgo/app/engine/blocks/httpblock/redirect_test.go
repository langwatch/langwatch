package httpblock_test

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

func executorAllowing(srv *httptest.Server) *httpblock.Executor {
	host, _, _ := net.SplitHostPort(srv.Listener.Addr().String())
	return httpblock.New(httpblock.Options{SSRF: httpblock.SSRFOptions{AllowedHosts: []string{host}}})
}

func TestExecute_RefusesCrossOriginRedirectWithCredentials(t *testing.T) {
	var reached atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached.Add(1)
	}))
	defer other.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/steal", http.StatusTemporaryRedirect)
	}))
	defer origin.Close()

	_, err := executorAllowing(origin).Execute(context.Background(), httpblock.Request{
		URL:  origin.URL,
		Auth: &httpblock.Auth{Type: "bearer", Token: "tok-abc"},
	})

	require.ErrorIs(t, err, httpblock.ErrCrossOriginRedirect)
	assert.Zero(t, reached.Load())
}

func TestExecute_RefusesCrossOriginRedirectWithCustomHeader(t *testing.T) {
	var reached atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached.Add(1)
	}))
	defer other.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL, http.StatusFound)
	}))
	defer origin.Close()

	_, err := executorAllowing(origin).Execute(context.Background(), httpblock.Request{
		URL:     origin.URL,
		Headers: map[string]string{"X-Tenant": "tenant-secret"},
	})

	require.ErrorIs(t, err, httpblock.ErrCrossOriginRedirect)
	assert.Zero(t, reached.Load())
}

func TestExecute_FollowsSameOriginRedirectWithCredentials(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/start" {
			http.Redirect(w, r, "/final", http.StatusTemporaryRedirect)
			return
		}
		got = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	res, err := executorAllowing(srv).Execute(context.Background(), httpblock.Request{
		URL:  srv.URL + "/start",
		Auth: &httpblock.Auth{Type: "bearer", Token: "tok-abc"},
	})

	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "Bearer tok-abc", got)
}

func TestExecute_RefusesCrossOriginRedirectWhenTheAddressCarriesCredentials(t *testing.T) {
	var reached atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached.Add(1)
	}))
	defer other.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL, http.StatusFound)
	}))
	defer origin.Close()

	for _, address := range []string{
		origin.URL + "/x?api_key=key-abc",
		strings.Replace(origin.URL, "http://", "http://robot:pass-abc@", 1),
	} {
		_, err := executorAllowing(origin).Execute(context.Background(), httpblock.Request{URL: address})

		require.ErrorIs(t, err, httpblock.ErrCrossOriginRedirect, address)
	}
	assert.Zero(t, reached.Load())
}

func TestExecute_DropsRefererOnCrossOriginRedirect(t *testing.T) {
	var referer atomic.Value
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		referer.Store(r.Header.Get("Referer"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer other.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL, http.StatusFound)
	}))
	defer origin.Close()
	_, err := executorAllowing(origin).Execute(context.Background(), httpblock.Request{URL: origin.URL + "/x?page=2"})

	require.NoError(t, err)
	assert.Empty(t, referer.Load())
}
