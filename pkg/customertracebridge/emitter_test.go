package customertracebridge

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/otelsetup"
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

// What leaves the process is the contract: every customer-retold span must
// carry a resource of exactly the langwatch.origin marker — never the
// gateway's own identity. The pod environment is set to the production shape
// here because otel-go's WithResource silently merges the provider resource
// over resource.Environment(); that merge is exactly how k8s topology leaked
// onto customer spans in production, and this test fails against any
// construction that lets it back in.
func TestEmitter_WireResourceIsOriginMarkerOnly(t *testing.T) {
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES",
		"k8s.pod.name=test-pod,cloud.region=eu-central-1,deployment.environment.name=lw-prod")
	t.Setenv("OTEL_SERVICE_NAME", "langwatch-service-aigateway")

	received := make(chan []byte, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		select {
		case received <- body:
		default:
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	registry := NewRegistry()
	require.NoError(t, registry.Set("proj-1", srv.URL, nil))

	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service: "langwatch-service-aigateway",
		Version: "test",
	})
	// The policy a service would declare: pass nothing through, stamp the
	// service's origin identity ("gateway" here, as the gateway's deps do).
	e, err := NewEmitter(ctx, EmitterOptions{
		Registry:     registry,
		BatchTimeout: 50 * time.Millisecond,
		Policy: Policy{Stamp: []attribute.KeyValue{
			attribute.String(otelsetup.AttrLangWatchOrigin, "gateway"),
		}},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.Shutdown(context.Background()) })

	spanCtx, _ := e.BeginSpan(ctx, "proj-1", domain.RequestTypeChat)
	// Real usage, or EndSpan classifies the span as a zero-cost probe and the
	// drop filter keeps it off the wire entirely.
	e.EndSpan(spanCtx, domain.AITraceParams{
		Model: "gpt-test",
		Usage: domain.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
	})
	require.NoError(t, e.tp.ForceFlush(context.Background()))

	var body []byte
	select {
	case body = <-received:
	case <-time.After(3 * time.Second):
		t.Fatal("no OTLP export received")
	}

	var req coltracepb.ExportTraceServiceRequest
	require.NoError(t, proto.Unmarshal(body, &req))
	require.NotEmpty(t, req.ResourceSpans)

	for _, rs := range req.ResourceSpans {
		attrs := rs.GetResource().GetAttributes()
		require.Len(t, attrs, 1,
			"customer-visible resource must carry ONLY the origin marker, got: %v", attrs)
		assert.Equal(t, otelsetup.AttrLangWatchOrigin, attrs[0].GetKey())
		assert.Equal(t, "gateway", attrs[0].GetValue().GetStringValue())
	}
}
