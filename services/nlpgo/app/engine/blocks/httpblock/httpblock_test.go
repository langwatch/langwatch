package httpblock_test

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

func TestRenderTemplate_StringEscaping(t *testing.T) {
	out, warns := httpblock.RenderTemplate(`{"x":"{{ s }}"}`, map[string]any{
		"s": `hello "world"` + "\n",
	})
	assert.Empty(t, warns)
	// json.Marshal will escape both quotes and the newline.
	assert.JSONEq(t, `{"x":"hello \"world\"\n"}`, out)
}

func TestRenderTemplate_ArrayEmbedding(t *testing.T) {
	out, _ := httpblock.RenderTemplate(`{"ids": {{ ids }}}`, map[string]any{
		"ids": []any{float64(1), float64(2), float64(3)},
	})
	assert.JSONEq(t, `{"ids": [1,2,3]}`, out)
}

func TestRenderTemplate_NestedPath(t *testing.T) {
	out, _ := httpblock.RenderTemplate("{{ user.name }}", map[string]any{
		"user": map[string]any{"name": "Alice"},
	})
	assert.Equal(t, "Alice", out)
}

func TestRenderTemplate_MissingVariableEmitsWarning(t *testing.T) {
	out, warns := httpblock.RenderTemplate("{{ ghost }}", map[string]any{})
	assert.Empty(t, out)
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
	assert.ErrorIs(t, err, httpblock.ErrNoMatch)
}

func TestExtractJSONPath_NumericIndex(t *testing.T) {
	data := []any{
		map[string]any{"id": float64(1)},
		map[string]any{"id": float64(2)},
	}
	got, err := httpblock.ExtractJSONPath(data, "$[1].id")
	require.NoError(t, err)
	assert.InDelta(t, 2.0, got, 1e-9)
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

// observedLogs returns a logger plus the buffer its entries land in, so a test
// can assert on what an operator would actually read.
func observedLogs() (*zap.Logger, *observer.ObservedLogs) {
	core, logs := observer.New(zap.InfoLevel)
	return zap.New(core), logs
}

// The ranges pkg/ssrf added on top of the historical deny set. Permitting
// these by default is what keeps a self-hosted upgrade from breaking a
// workflow that reaches an internal service over, say, Tailscale.
var newlyCoveredAddresses = []string{
	"100.64.0.1",  // CGNAT / Tailscale (RFC 6598)
	"240.0.0.1",   // reserved (RFC 1112)
	"198.18.0.1",  // benchmarking (RFC 2544)
	"192.0.2.1",   // TEST-NET-1 (RFC 5737)
	"224.0.1.1",   // multicast, not link-local
	"203.0.113.1", // TEST-NET-3 (RFC 5737)
}

func TestSSRF_WhenStrictEgressIsOff(t *testing.T) {
	t.Run("permits addresses outside the historical deny set", func(t *testing.T) {
		for _, ip := range newlyCoveredAddresses {
			t.Run(ip, func(t *testing.T) {
				err := httpblock.CheckURL("http://"+ip+"/x", httpblock.SSRFOptions{})
				assert.NoError(t, err,
					"%s was reachable before strict egress existed and must stay reachable by default", ip)
			})
		}
	})

	t.Run("logs each permitted non-public address so the operator can prepare", func(t *testing.T) {
		logger, logs := observedLogs()
		err := httpblock.CheckURL("http://100.64.0.1/x", httpblock.SSRFOptions{Logger: logger})
		require.NoError(t, err)

		entries := logs.FilterMessage("ssrf_permitted_non_public_address").All()
		require.Len(t, entries, 1, "a permitted non-public address must be reported exactly once")

		fields := entries[0].ContextMap()
		assert.Equal(t, "100.64.0.1", fields["address"])
		assert.Contains(t, fields["range"], "100.64.0.0/10")
		assert.Contains(t, fields["range"], "RFC 6598", "the log must name the RFC, not just the CIDR")
		assert.Contains(t, fields["hint"], "ALLOWED_PROXY_HOSTS",
			"the hint must tell the operator how to keep this working under strict egress")
	})

	t.Run("still refuses the historical deny set", func(t *testing.T) {
		for _, ip := range []string{"127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1"} {
			t.Run(ip, func(t *testing.T) {
				err := httpblock.CheckURL("http://"+ip+"/x", httpblock.SSRFOptions{})
				require.Error(t, err)
			})
		}
	})

	t.Run("still refuses cloud metadata", func(t *testing.T) {
		// Azure WireServer is globally-routable-looking and sits in no
		// special range, so only the metadata set catches it. It was
		// reachable before pkg/ssrf; that hole closes for everyone.
		err := httpblock.CheckURL("http://168.63.129.16/x", httpblock.SSRFOptions{})
		require.Error(t, err)
	})
}

func TestSSRF_WhenStrictEgressIsOn(t *testing.T) {
	t.Run("refuses every non-globally-routable address", func(t *testing.T) {
		for _, ip := range newlyCoveredAddresses {
			t.Run(ip, func(t *testing.T) {
				err := httpblock.CheckURL("http://"+ip+"/x", httpblock.SSRFOptions{
					StrictPublicOnly: true,
				})
				require.Error(t, err)
			})
		}
	})

	t.Run("names the range and the escape hatch in the refusal log", func(t *testing.T) {
		logger, logs := observedLogs()
		err := httpblock.CheckURL("http://100.64.0.1/x", httpblock.SSRFOptions{
			StrictPublicOnly: true,
			Logger:           logger,
		})
		require.Error(t, err)

		entries := logs.FilterMessage("ssrf_refused").All()
		require.Len(t, entries, 1)

		fields := entries[0].ContextMap()
		assert.Equal(t, "strict_public_only", fields["reason"])
		assert.Contains(t, fields["range"], "CGNAT")
		assert.Contains(t, fields["hint"], "ALLOWED_PROXY_HOSTS")
	})

	t.Run("keeps the allow-list working as the escape hatch", func(t *testing.T) {
		err := httpblock.CheckURL("http://100.64.0.1/x", httpblock.SSRFOptions{
			StrictPublicOnly: true,
			AllowedHosts:     []string{"100.64.0.1"},
		})
		assert.NoError(t, err)
	})

	t.Run("permits globally routable addresses", func(t *testing.T) {
		err := httpblock.CheckURL("http://93.184.216.34/x", httpblock.SSRFOptions{
			StrictPublicOnly: true,
		})
		assert.NoError(t, err)
	})
}

func TestSSRF_RefusalLogNeverReachesTheCaller(t *testing.T) {
	// The log names the range; the error must not. An SSRF refusal that
	// echoes which internal range was hit hands the tenant a network map.
	logger, logs := observedLogs()
	err := httpblock.CheckURL("http://10.1.2.3/x", httpblock.SSRFOptions{Logger: logger})

	require.Error(t, err)
	assert.Equal(t, "ssrf_blocked", err.Error())
	require.NotEmpty(t, logs.FilterMessage("ssrf_refused").All(),
		"the detail belongs in the log, which is why the error can stay opaque")
}

func TestSSRF_StrictEgressAppliesAtDialTime(t *testing.T) {
	// CheckURL is the optimistic gate; SafeDialer is the one that holds
	// under DNS rebinding. Strict mode must be enforced in both.
	dial := httpblock.SafeDialer(httpblock.SSRFOptions{
		StrictPublicOnly: true,
		Resolver: func(host string) ([]net.IP, error) {
			return []net.IP{net.ParseIP("100.64.0.1")}, nil
		},
	})
	_, err := dial(context.Background(), "tcp", "rebind.test:80")
	require.ErrorIs(t, err, httpblock.ErrSSRFBlocked)
}

func TestExecute_HappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "Bearer tok-abc", r.Header.Get("Authorization"))
		var got map[string]any
		assert.NoError(t, json.Unmarshal(body, &got))
		assert.Equal(t, "ping", got["q"])
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
		w.WriteHeader(http.StatusOK)
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
		w.WriteHeader(http.StatusServiceUnavailable)
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
	require.ErrorAs(t, err, &ue)
	assert.Equal(t, 503, ue.Status)
	assert.Contains(t, string(ue.Body), "boom")
}

func TestExecute_ApiKeyAuth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "secret-123", r.Header.Get("X-API-Key"))
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
	assert.ErrorIs(t, err, httpblock.ErrSSRFBlocked)
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
	assert.ErrorIs(t, err, httpblock.ErrSSRFBlocked,
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
	assert.ErrorIs(t, err, httpblock.ErrSSRFBlocked)
}

// TestSafeDialer_BlocksLiteralPrivateIP catches direct dials by IP.
func TestSafeDialer_BlocksLiteralPrivateIP(t *testing.T) {
	dial := httpblock.SafeDialer(httpblock.SSRFOptions{})
	_, err := dial(context.Background(), "tcp", "10.0.0.1:80")
	require.Error(t, err)
	assert.ErrorIs(t, err, httpblock.ErrSSRFBlocked)
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
// is honored (Options.MaxResponseBytes was previously documented but
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
	assert.Len(t, res.UpstreamBody, 64,
		"expected MaxResponseBytes to truncate at 64, got %d", len(res.UpstreamBody))
}

// TestDefaultTimeoutAccommodatesSlowAgents pins the per-request HTTP
// block default timeout at 12 minutes. langwatch_nlp regression
// 06f93d1eb bumped from 30s to 300s ("increase HTTP agent default
// timeout to 5 minutes") but didn't go far enough — customer agent
// backends routinely take 10+ minutes (RAG retrieval, multi-step
// scrapers, sub-workflow chains). The Go path anchors at 12 minutes
// per owner directive: high enough to cover real agents, with a
// 3-minute margin under Lambda's 15-minute hard execution cap so the
// response payload has time to drain and the rest of the workflow
// to finalize. A regression to a shorter default would silently kill
// slow-agent calls.
func TestDefaultTimeoutAccommodatesSlowAgents(t *testing.T) {
	if httpblock.DefaultTimeout != 12*time.Minute {
		t.Errorf("httpblock.DefaultTimeout = %s; want 12m (slow agents take 10+ min, Lambda capped at 15min so 3min margin)",
			httpblock.DefaultTimeout)
	}
}
