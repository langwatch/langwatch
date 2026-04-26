package httpblock_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

func TestRenderTemplate_StringEscaping(t *testing.T) {
	out, warns := httpblock.RenderTemplate(`{"x":"{{ s }}"}`, map[string]any{
		"s": `hello "world"` + "\n",
	})
	assert.Empty(t, warns)
	// json.Marshal will escape both quotes and the newline.
	assert.Equal(t, `{"x":"hello \"world\"\n"}`, out)
}

func TestRenderTemplate_ArrayEmbedding(t *testing.T) {
	out, _ := httpblock.RenderTemplate(`{"ids": {{ ids }}}`, map[string]any{
		"ids": []any{float64(1), float64(2), float64(3)},
	})
	assert.Equal(t, `{"ids": [1,2,3]}`, out)
}

func TestRenderTemplate_NestedPath(t *testing.T) {
	out, _ := httpblock.RenderTemplate("{{ user.name }}", map[string]any{
		"user": map[string]any{"name": "Alice"},
	})
	assert.Equal(t, "Alice", out)
}

func TestRenderTemplate_MissingVariableEmitsWarning(t *testing.T) {
	out, warns := httpblock.RenderTemplate("{{ ghost }}", map[string]any{})
	assert.Equal(t, "", out)
	require.Len(t, warns, 1)
	assert.Contains(t, warns[0], "ghost")
}

func TestExtractJSONPath_RootSelector(t *testing.T) {
	data := map[string]any{"a": 1.0}
	got, err := httpblock.ExtractJSONPath(data, "$")
	require.NoError(t, err)
	assert.Equal(t, data, got)
}

func TestExtractJSONPath_NestedKey(t *testing.T) {
	data := map[string]any{
		"data": map[string]any{
			"first": map[string]any{"name": "Alice"},
		},
	}
	got, err := httpblock.ExtractJSONPath(data, "$.data.first.name")
	require.NoError(t, err)
	assert.Equal(t, "Alice", got)
}

func TestExtractJSONPath_Wildcard(t *testing.T) {
	data := map[string]any{
		"items": []any{
			map[string]any{"id": float64(1)},
			map[string]any{"id": float64(2)},
			map[string]any{"id": float64(3)},
		},
	}
	got, err := httpblock.ExtractJSONPath(data, "$.items[*].id")
	require.NoError(t, err)
	assert.Equal(t, []any{float64(1), float64(2), float64(3)}, got)
}

func TestExtractJSONPath_NoMatch(t *testing.T) {
	data := map[string]any{"present": "value"}
	_, err := httpblock.ExtractJSONPath(data, "$.missing")
	require.Error(t, err)
	assert.True(t, errors.Is(err, httpblock.ErrNoMatch))
}

func TestExtractJSONPath_NumericIndex(t *testing.T) {
	data := []any{
		map[string]any{"id": float64(1)},
		map[string]any{"id": float64(2)},
	}
	got, err := httpblock.ExtractJSONPath(data, "$[1].id")
	require.NoError(t, err)
	assert.Equal(t, float64(2), got)
}

func TestSSRF_BlocksLoopback(t *testing.T) {
	for _, u := range []string{
		"http://127.0.0.1/x",
		"http://localhost/",
		"http://0.0.0.0/x",
		"http://[::1]/",
		"http://10.0.0.1/x",
		"http://192.168.0.1/x",
		"http://169.254.169.254/latest/meta-data/",
	} {
		t.Run(u, func(t *testing.T) {
			err := httpblock.CheckURL(u, httpblock.SSRFOptions{})
			require.Error(t, err)
		})
	}
}

func TestSSRF_AllowList(t *testing.T) {
	err := httpblock.CheckURL("http://127.0.0.1:9001/x", httpblock.SSRFOptions{
		AllowedHosts: []string{"127.0.0.1"},
	})
	assert.NoError(t, err)
}

func TestSSRF_AlwaysBlocksMetadataEvenIfAllowed(t *testing.T) {
	err := httpblock.CheckURL("http://169.254.169.254/x", httpblock.SSRFOptions{
		AllowedHosts: []string{"169.254.169.254"},
	})
	require.Error(t, err)
}

func TestSSRF_DNSResolutionToPrivate(t *testing.T) {
	resolver := func(host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("10.0.0.5")}, nil
	}
	err := httpblock.CheckURL("http://internal.test/", httpblock.SSRFOptions{
		Resolver: resolver,
	})
	require.Error(t, err)
}

func TestExecute_HappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		require.Equal(t, "POST", r.Method)
		require.Equal(t, "Bearer tok-abc", r.Header.Get("Authorization"))
		var got map[string]any
		require.NoError(t, json.Unmarshal(body, &got))
		require.Equal(t, "ping", got["q"])
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"result":"pong"}`)
	}))
	defer srv.Close()
	host, _, _ := net.SplitHostPort(srv.Listener.Addr().String())

	exec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{host}},
	})
	res, err := exec.Execute(context.Background(), httpblock.Request{
		URL:          srv.URL + "/echo",
		Method:       "POST",
		BodyTemplate: `{"q":"{{ q }}"}`,
		OutputPath:   "$.result",
		Auth:         &httpblock.Auth{Type: "bearer", Token: "tok-abc"},
		Inputs:       map[string]any{"q": "ping"},
	})
	require.NoError(t, err)
	assert.Equal(t, "pong", res.Output)
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestExecute_TimeoutAbortsRequest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(200)
	}))
	defer srv.Close()
	host, _, _ := net.SplitHostPort(srv.Listener.Addr().String())

	exec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{host}},
	})
	start := time.Now()
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:       srv.URL + "/slow",
		Method:    "GET",
		TimeoutMS: 250,
	})
	elapsed := time.Since(start)
	require.Error(t, err)
	assert.Less(t, elapsed, 1*time.Second)
}

func TestExecute_NonSuccessStatusReturnsUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(503)
		_, _ = io.WriteString(w, `{"err":"boom"}`)
	}))
	defer srv.Close()
	host, _, _ := net.SplitHostPort(srv.Listener.Addr().String())

	exec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{host}},
	})
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:    srv.URL + "/broken",
		Method: "GET",
	})
	require.Error(t, err)
	var ue *httpblock.UpstreamError
	require.True(t, errors.As(err, &ue))
	assert.Equal(t, 503, ue.Status)
	assert.Contains(t, string(ue.Body), "boom")
}

func TestExecute_ApiKeyAuth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "secret-123", r.Header.Get("X-API-Key"))
		_, _ = io.WriteString(w, `{}`)
	}))
	defer srv.Close()
	host, _, _ := net.SplitHostPort(srv.Listener.Addr().String())

	exec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{host}},
	})
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:    srv.URL + "/x",
		Method: "GET",
		Auth:   &httpblock.Auth{Type: "api_key", Header: "X-API-Key", Value: "secret-123"},
	})
	require.NoError(t, err)
}

func TestExecute_BasicAuth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		assert.Contains(t, auth, "Basic ")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer srv.Close()
	host, _, _ := net.SplitHostPort(srv.Listener.Addr().String())

	exec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{host}},
	})
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:    srv.URL + "/x",
		Method: "GET",
		Auth:   &httpblock.Auth{Type: "basic", Username: "u", Password: "p"},
	})
	require.NoError(t, err)
}

func TestExecute_BlocksSSRF(t *testing.T) {
	exec := httpblock.New(httpblock.Options{})
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:    "http://127.0.0.1:9001/x",
		Method: "GET",
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, httpblock.ErrSSRFBlocked))
}

// TestSafeDialer_BlocksPrivateIPAtDialTime simulates the DNS-rebinding
// TOCTOU: the resolver returns a private IP at dial time, and the
// dialer must reject before opening a connection. This is independent
// of CheckURL — it's the second line of defense.
func TestSafeDialer_BlocksPrivateIPAtDialTime(t *testing.T) {
	dial := httpblock.SafeDialer(httpblock.SSRFOptions{
		Resolver: func(host string) ([]net.IP, error) {
			return []net.IP{net.ParseIP("10.0.0.5")}, nil
		},
	})
	_, err := dial(context.Background(), "tcp", "rebound.example:80")
	require.Error(t, err)
	assert.True(t, errors.Is(err, httpblock.ErrSSRFBlocked),
		"expected ErrSSRFBlocked, got %v", err)
}

func TestSafeDialer_BlocksMetadataIPAtDialTime(t *testing.T) {
	dial := httpblock.SafeDialer(httpblock.SSRFOptions{
		Resolver: func(host string) ([]net.IP, error) {
			return []net.IP{net.ParseIP("169.254.169.254")}, nil
		},
	})
	_, err := dial(context.Background(), "tcp", "imds-bait.example:80")
	require.Error(t, err)
	assert.True(t, errors.Is(err, httpblock.ErrSSRFBlocked))
}

// TestSafeDialer_BlocksLiteralPrivateIP catches direct dials by IP.
func TestSafeDialer_BlocksLiteralPrivateIP(t *testing.T) {
	dial := httpblock.SafeDialer(httpblock.SSRFOptions{})
	_, err := dial(context.Background(), "tcp", "10.0.0.1:80")
	require.Error(t, err)
	assert.True(t, errors.Is(err, httpblock.ErrSSRFBlocked))
}

// TestExecute_TruncatedBodySurfacesError proves a partial-read on a
// 2xx response is no longer silently downgraded to garbled output.
// The upstream declares Content-Length: 100 but only writes 7 bytes
// before the connection closes; net/http surfaces io.ErrUnexpectedEOF
// and the executor must propagate that as a clean error rather than
// piping a truncated JSON string into downstream nodes.
func TestExecute_TruncatedBodySurfacesError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "100")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"a":1}`)) // 7 of declared 100
	}))
	defer srv.Close()
	host, _, _ := net.SplitHostPort(srv.Listener.Addr().String())

	exec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{host}},
	})
	_, err := exec.Execute(context.Background(), httpblock.Request{
		URL:    srv.URL + "/short",
		Method: "GET",
	})
	require.Error(t, err, "partial 2xx response must surface as an error, not be silently truncated")
	assert.Contains(t, err.Error(), "httpblock", "error should be tagged with the executor namespace")
}

// TestExecute_TruncatesResponseAtMaxBytes proves the configured cap
// is honoured (Options.MaxResponseBytes was previously documented but
// not wired — every response was capped at the hard-coded 4 MiB).
func TestExecute_TruncatesResponseAtMaxBytes(t *testing.T) {
	payload := make([]byte, 1024)
	for i := range payload {
		payload[i] = 'x'
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write(payload)
	}))
	defer srv.Close()
	host, _, _ := net.SplitHostPort(srv.Listener.Addr().String())

	exec := httpblock.New(httpblock.Options{
		SSRF:             httpblock.SSRFOptions{AllowedHosts: []string{host}},
		MaxResponseBytes: 64,
	})
	res, err := exec.Execute(context.Background(), httpblock.Request{
		URL:    srv.URL + "/big",
		Method: "GET",
	})
	require.NoError(t, err)
	require.NotNil(t, res)
	// Response is non-JSON so executor falls back to string output.
	assert.Equal(t, 64, len(res.UpstreamBody),
		"expected MaxResponseBytes to truncate at 64, got %d", len(res.UpstreamBody))
}
