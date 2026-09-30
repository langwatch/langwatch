package customertracebridge

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/langwatch/langwatch/pkg/aitrace"
	"github.com/langwatch/langwatch/pkg/contexts"
)

func counterTotal(t *testing.T, reader *sdkmetric.ManualReader, name string) int64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))
	var total int64
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if sum, ok := m.Data.(metricdata.Sum[int64]); ok && m.Name == name {
				for _, dp := range sum.DataPoints {
					total += dp.Value
				}
			}
		}
	}
	return total
}

// The gateway builds its emitter with none of the routed options: its spans
// must still route by bare project id, under the gateway's metric names.
func TestEmitter_DefaultOptionsRouteByProjectIDAsBefore(t *testing.T) {
	in := newIngest(t)
	registry := NewRegistry()
	require.NoError(t, registry.SetFromBundle("proj-1", "tok-1", in.URL))

	reader := sdkmetric.NewManualReader()
	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service: "langwatch-service-aigateway", Version: "test",
	})
	e, err := NewEmitter(ctx, EmitterOptions{
		Registry:      registry,
		BatchTimeout:  50 * time.Millisecond,
		MeterProvider: sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)),
	})
	require.NoError(t, err)

	spanCtx, _ := e.BeginSpan(ctx, "proj-1", aitrace.RequestTypeChat)
	e.EndSpan(spanCtx, aitrace.Params{
		Model: "gpt-test",
		Usage: aitrace.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
	})
	require.NoError(t, e.Shutdown(context.Background()))

	assert.Equal(t, []string{"tok-1"}, in.received())
	assert.Equal(t, []string{"proj-1"}, in.receivedProjects())
	assert.Equal(t, int64(1),
		counterTotal(t, reader, "langwatch.gateway.customer_trace.spans_exported"))
}

func TestRouteKey_SeparatesTokensOfOneProject(t *testing.T) {
	a := RouteKey("proj-1", "tok-a")
	b := RouteKey("proj-1", "tok-b")

	assert.NotEqual(t, a, b)
	assert.Regexp(t, `^proj-1:[0-9a-f]{12}$`, a)
	assert.NotContains(t, a, "tok-a")
}

// A keyless request must neither register nor revoke: removing an entry here
// would cut off another request's export for the same project.
func TestRegistry_SetRoute_KeylessRequestTouchesNothing(t *testing.T) {
	r := NewRegistry()
	key, err := r.SetRoute("proj-1", "tok-1", "https://ingest.example")
	require.NoError(t, err)
	require.Equal(t, RouteKey("proj-1", "tok-1"), key)

	for _, c := range []struct{ projectID, token, endpoint string }{
		{"proj-1", "", "https://ingest.example"},
		{"", "tok-1", "https://ingest.example"},
		{"proj-1", "tok-1", ""},
	} {
		got, err := r.SetRoute(c.projectID, c.token, c.endpoint)
		require.NoError(t, err)
		assert.Empty(t, got)
	}

	_, headers, ok := r.Lookup(key)
	require.True(t, ok)
	assert.Equal(t, "tok-1", headers["X-Auth-Token"])
	_, _, bare := r.Lookup("proj-1")
	assert.False(t, bare, "a routed pair must not register under the bare project id")
}

func TestRegistry_SetRoute_RejectsNonHTTPEndpoint(t *testing.T) {
	_, err := NewRegistry().SetRoute("proj-1", "tok-1", "file:///etc/passwd")
	require.ErrorIs(t, err, ErrInvalidEndpoint)
}
