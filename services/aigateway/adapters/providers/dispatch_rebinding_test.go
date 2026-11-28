package providers

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// loopbackProvider is an Anthropic-compatible server on 127.0.0.1 that counts
// every request it receives.
func loopbackProvider(t *testing.T) (port string, hits *atomic.Int32) {
	t.Helper()
	hits = &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"m","usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	t.Cleanup(srv.Close)
	_, port, err := net.SplitHostPort(srv.Listener.Addr().String())
	require.NoError(t, err)
	return port, hits
}

// refusalLog records the egress proxy's refusals, so a test can tell a
// refused connection from one that failed for another reason.
func refusalLog() (*zap.Logger, func() int) {
	core, logs := observer.New(zap.WarnLevel)
	return zap.New(core), func() int { return logs.FilterMessage("egress_proxy_refused").Len() }
}

func dispatchMessages(router *BifrostRouter, baseURL string) error {
	_, err := router.Dispatch(context.Background(), &domain.Request{
		Type:  domain.RequestTypeMessages,
		Model: "claude-sonnet-5",
		Body:  []byte(`{"model":"claude-sonnet-5","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}`),
	}, domain.Credential{
		ID:         "mp-rebinding",
		ProviderID: domain.ProviderAnthropic,
		APIKey:     "sk-local",
		Extra:      map[string]string{"base_url": baseURL},
	})
	return err
}

// The early endpoint check sees a public address; the connection then
// resolves the same name again, and "localhost" is loopback. Before the fix
// Bifrost's own dialer let loopback through whatever the policy said.
//
// @scenario "A provider endpoint that resolves to loopback only at connect time is not reached"
func TestDispatchDoesNotReachLoopbackWhenTheNameRebindsAfterTheCheck(t *testing.T) {
	port, hits := loopbackProvider(t)
	logger, refusals := refusalLog()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger: logger, InitialPoolSize: 10, BlockLocalHTTPCalls: true,
	})
	require.NoError(t, err)
	t.Cleanup(router.Close)
	router.endpointPolicy.resolve = staticResolver("93.184.216.34")

	err = dispatchMessages(router, "http://localhost:"+port)

	require.Error(t, err)
	assert.Zero(t, hits.Load(), "the loopback listener must never see the request")
	assert.Positive(t, refusals(), "the egress policy refused the connection")
}

// @scenario "An allowlisted provider host on loopback is still reached"
func TestDispatchReachesAnAllowlistedLoopbackHost(t *testing.T) {
	port, hits := loopbackProvider(t)
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger: zap.NewNop(), InitialPoolSize: 10, BlockLocalHTTPCalls: true,
		AllowedEndpointHosts: []string{"localhost"},
	})
	require.NoError(t, err)
	t.Cleanup(router.Close)

	require.NoError(t, dispatchMessages(router, "http://localhost:"+port))
	assert.Equal(t, int32(1), hits.Load())
}

// @scenario "A provider endpoint that names loopback or metadata directly is refused"
func TestDispatchRefusesADirectLoopbackOrMetadataEndpoint(t *testing.T) {
	port, hits := loopbackProvider(t)
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger: zap.NewNop(), InitialPoolSize: 10, BlockLocalHTTPCalls: true,
	})
	require.NoError(t, err)
	t.Cleanup(router.Close)

	require.Error(t, dispatchMessages(router, "http://127.0.0.1:"+port))
	require.Error(t, dispatchMessages(router, "http://169.254.169.254"))
	assert.Zero(t, hits.Load())
}

// Local calls allowed: the check sees a public address, the connection sees
// 127.0.0.1 for a name that is not a loopback name, and is refused.
//
// @scenario "A provider endpoint that resolves to loopback only at connect time is not reached"
func TestDispatchDoesNotReachLoopbackThroughARebindingNameWithLocalCallsAllowed(t *testing.T) {
	port, hits := loopbackProvider(t)
	lookups := atomic.Int32{}
	logger, refusals := refusalLog()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger: logger, InitialPoolSize: 10,
		lookup: func(context.Context, string) ([]netip.Addr, error) {
			if lookups.Add(1) == 1 {
				return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
			}
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		},
	})
	require.NoError(t, err)
	t.Cleanup(router.Close)

	err = dispatchMessages(router, "http://rebind.example:"+port)

	require.Error(t, err)
	assert.GreaterOrEqual(t, lookups.Load(), int32(2), "the connection resolved the name after the check")
	assert.Zero(t, hits.Load(), "the loopback listener must never see the request")
	assert.Positive(t, refusals(), "the egress policy refused the connection")
}
