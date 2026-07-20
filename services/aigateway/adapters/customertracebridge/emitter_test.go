package customertracebridge

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestParseTraceparent_valid(t *testing.T) {
	tp := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	traceID, spanID := parseTraceparent(tp)
	assert.Len(t, traceID, 16)
	assert.Len(t, spanID, 8)
	assert.Equal(t, "4bf92f3577b34da6a3ce929d0e0e4736", hexEncode(traceID))
	assert.Equal(t, "00f067aa0ba902b7", hexEncode(spanID))
}

func TestParseTraceparent_empty(t *testing.T) {
	traceID, spanID := parseTraceparent("")
	assert.Nil(t, traceID)
	assert.Nil(t, spanID)
}

func TestParseTraceparent_malformed(t *testing.T) {
	tests := []string{
		"not-a-traceparent",
		"00-short-00f067aa0ba902b7-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-short-01",
	}
	for _, tp := range tests {
		traceID, spanID := parseTraceparent(tp)
		assert.Nil(t, traceID, "traceparent: %s", tp)
		assert.Nil(t, spanID, "traceparent: %s", tp)
	}
}

func TestRegistry_Set_ValidatesScheme(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		wantErr  bool
	}{
		{name: "https allowed", endpoint: "https://otel.internal:4318", wantErr: false},
		{name: "http allowed", endpoint: "http://localhost:4318", wantErr: false},
		{name: "empty clears entry", endpoint: "", wantErr: false},
		{name: "ftp rejected", endpoint: "ftp://evil.com/exfil", wantErr: true},
		{name: "file rejected", endpoint: "file:///etc/passwd", wantErr: true},
		{name: "javascript rejected", endpoint: "javascript:alert(1)", wantErr: true},
		{name: "no scheme rejected", endpoint: "evil.com:4318", wantErr: true},
		{name: "data uri rejected", endpoint: "data:text/plain,hello", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewRegistry()
			err := r.Set("proj-1", tt.endpoint, nil)
			if tt.wantErr {
				assert.ErrorIs(t, err, ErrInvalidEndpoint)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestRegistry_Lookup(t *testing.T) {
	r := NewRegistry()
	_ = r.Set("proj-1", "https://otel.internal:4318/v1/traces", map[string]string{"X-Auth-Token": "tok"})

	endpoint, headers, ok := r.Lookup("proj-1")
	assert.True(t, ok)
	assert.Equal(t, "https://otel.internal:4318/v1/traces", endpoint)
	assert.Equal(t, "tok", headers["X-Auth-Token"])
}

func TestRegistry_Set_ClearsWithEmpty(t *testing.T) {
	r := NewRegistry()
	_ = r.Set("proj-1", "https://otel.internal:4318", nil)
	_ = r.Set("proj-1", "", nil)

	_, _, ok := r.Lookup("proj-1")
	assert.False(t, ok)
}

func TestRegistry_SetFromBundle_RegistersTokenAsAuthHeader(t *testing.T) {
	r := NewRegistry()

	require.NoError(t, r.SetFromBundle("proj-1", "tok-1", "http://app:5560/api/otel"))

	endpoint, headers, ok := r.Lookup("proj-1")
	assert.True(t, ok)
	assert.Equal(t, "http://app:5560/api/otel", endpoint)
	assert.Equal(t, "tok-1", headers["X-Auth-Token"])
}

// A bundle whose OTLP token is gone means the control plane revoked or rotated
// it. The cached entry must go WITH it — otherwise the bridge keeps exporting
// this project's spans under the dead token until LRU pressure happens to
// evict it, which on a quiet gateway is never.
func TestRegistry_SetFromBundle_ClearedTokenRevokesTheCachedEntry(t *testing.T) {
	r := NewRegistry()
	assert.NoError(t, r.SetFromBundle("proj-1", "tok-1", "http://app:5560/api/otel"))

	assert.NoError(t, r.SetFromBundle("proj-1", "", "http://app:5560/api/otel"))

	_, _, ok := r.Lookup("proj-1")
	assert.False(t, ok, "a revoked token must stop trace export immediately, not on LRU eviction")
}

func TestRegistry_SetFromBundle_ClearedEndpointRevokesTheCachedEntry(t *testing.T) {
	r := NewRegistry()
	assert.NoError(t, r.SetFromBundle("proj-1", "tok-1", "http://app:5560/api/otel"))

	assert.NoError(t, r.SetFromBundle("proj-1", "tok-1", ""))

	_, _, ok := r.Lookup("proj-1")
	assert.False(t, ok)
}

func TestRegistry_SetFromBundle_IgnoresEmptyProject(t *testing.T) {
	r := NewRegistry()

	assert.NoError(t, r.SetFromBundle("", "tok-1", "http://app:5560/api/otel"))
	assert.NoError(t, r.SetFromBundle("", "", ""))
}

func hexEncode(b []byte) string {
	const hexChars = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = hexChars[v>>4]
		out[i*2+1] = hexChars[v&0x0f]
	}
	return string(out)
}


// The bridge's TracerProvider resource is the customer-visible resource on
// every retold span. It must carry the origin marker (the control plane's
// trace-origin resolution treats resource-level langwatch.origin as
// authoritative) and NOTHING else — no service identity, k8s topology, or
// cloud attributes: that is LangWatch infrastructure detail and must never
// ride on customer data.
func TestEmitter_CustomerSpanResourceIsOriginMarkerOnly(t *testing.T) {
	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service: "langwatch-service-aigateway",
		Version: "test",
	})

	e, err := NewEmitter(ctx, EmitterOptions{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.Shutdown(context.Background()) })

	captured := make(chan sdktrace.ReadOnlySpan, 1)
	e.tp.RegisterSpanProcessor(captureProcessor{spans: captured})

	spanCtx, _ := e.BeginSpan(ctx, "proj-1", domain.RequestTypeChat)
	e.EndSpan(spanCtx, domain.AITraceParams{})

	select {
	case span := <-captured:
		kvs := span.Resource().Attributes()
		require.Len(t, kvs, 1,
			"customer-visible resource must carry ONLY the origin marker, got: %v", kvs)
		assert.Equal(t, gatewaytracer.AttrOrigin, string(kvs[0].Key))
		assert.Equal(t, gatewaytracer.OriginGateway, kvs[0].Value.AsString())
	case <-time.After(2 * time.Second):
		t.Fatal("no span captured")
	}
}

type captureProcessor struct{ spans chan sdktrace.ReadOnlySpan }

func (p captureProcessor) OnStart(context.Context, sdktrace.ReadWriteSpan) {}
func (p captureProcessor) OnEnd(s sdktrace.ReadOnlySpan) {
	select {
	case p.spans <- s:
	default:
	}
}
func (p captureProcessor) Shutdown(context.Context) error   { return nil }
func (p captureProcessor) ForceFlush(context.Context) error { return nil }

// True repro of the production leak: on a real pod, OTEL_RESOURCE_ATTRIBUTES /
// OTEL_SERVICE_NAME carry the gateway's infra identity, and otel-go's
// WithResource silently merges the given resource OVER resource.Environment()
// — so "empty resource" still shipped k8s topology, cloud region, and service
// identity on every customer-retold span. This test constructs the emitter
// with those variables set, exactly like production, and asserts none of it
// survives onto the customer-visible resource.
func TestEmitter_CustomerSpanResourceExcludesPodEnvironment(t *testing.T) {
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES",
		"k8s.pod.name=test-pod,cloud.region=eu-central-1,deployment.environment.name=lw-prod")
	t.Setenv("OTEL_SERVICE_NAME", "langwatch-service-aigateway")

	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service: "langwatch-service-aigateway",
		Version: "test",
	})

	e, err := NewEmitter(ctx, EmitterOptions{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.Shutdown(context.Background()) })

	// Construction must not eat the process env — the gateway's own ops
	// provider still needs these variables afterwards.
	v, ok := os.LookupEnv("OTEL_SERVICE_NAME")
	require.True(t, ok)
	assert.Equal(t, "langwatch-service-aigateway", v)

	captured := make(chan sdktrace.ReadOnlySpan, 1)
	e.tp.RegisterSpanProcessor(captureProcessor{spans: captured})

	spanCtx, _ := e.BeginSpan(ctx, "proj-1", domain.RequestTypeChat)
	e.EndSpan(spanCtx, domain.AITraceParams{})

	select {
	case span := <-captured:
		kvs := span.Resource().Attributes()
		require.Len(t, kvs, 1,
			"pod environment leaked onto the customer-visible resource: %v", kvs)
		assert.Equal(t, gatewaytracer.AttrOrigin, string(kvs[0].Key))
		assert.Equal(t, gatewaytracer.OriginGateway, kvs[0].Value.AsString())
	case <-time.After(2 * time.Second):
		t.Fatal("no span captured")
	}
}
