package otlp

import (
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

// protobufReceiver decodes OTLP/protobuf trace exports.
type protobufReceiver struct {
	t        *testing.T
	mu       sync.Mutex
	headers  []http.Header
	requests []*collectortrace.ExportTraceServiceRequest
}

func (r *protobufReceiver) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	var body io.Reader = req.Body
	if req.Header.Get("Content-Encoding") == "gzip" {
		zr, err := gzip.NewReader(req.Body)
		require.NoError(r.t, err)
		body = zr
	}
	raw, err := io.ReadAll(body)
	require.NoError(r.t, err)
	var msg collectortrace.ExportTraceServiceRequest
	require.NoError(r.t, proto.Unmarshal(raw, &msg))

	r.mu.Lock()
	r.headers = append(r.headers, req.Header.Clone())
	r.requests = append(r.requests, &msg)
	r.mu.Unlock()
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
}

func TestNewExporter_SendsOTLPProtobufWithLangWatchHeaders(t *testing.T) {
	rec := &protobufReceiver{t: t}
	srv := httptest.NewServer(rec)
	defer srv.Close()

	exporter, err := NewDefaultExporter(context.Background(),
		langwatch.WithAPIKey("sk-lw-test"),
		langwatch.WithProjectID("project-1"),
		langwatch.WithEndpoint(srv.URL),
	)
	require.NoError(t, err)

	require.NoError(t, exporter.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{
		tracetest.SpanStub{Name: "GET /api"}.Snapshot(),
		tracetest.SpanStub{Name: "llm.chat"}.Snapshot(),
	}))
	require.NoError(t, exporter.Shutdown(context.Background()))

	require.Len(t, rec.requests, 1)
	h := rec.headers[0]
	assert.Equal(t, "application/x-protobuf", h.Get("Content-Type"))
	assert.Equal(t, "Bearer sk-lw-test", h.Get("Authorization"))
	assert.Equal(t, "project-1", h.Get("X-Project-Id"))
	assert.Equal(t, "langwatch-sdk-go", h.Get("X-Langwatch-Sdk-Name"))

	spans := rec.requests[0].GetResourceSpans()[0].GetScopeSpans()[0].GetSpans()
	require.Len(t, spans, 1, "the default preset still filters HTTP spans")
	assert.Equal(t, "llm.chat", spans[0].GetName())
}

func TestNewExporter_DoesNotMutateCallerOptions(t *testing.T) {
	opts := make([]langwatch.ExporterOption, 1, 2)
	opts[0] = langwatch.WithEndpoint("https://example.test")
	tail := opts[:2]

	exporter, err := NewExporter(context.Background(), opts...)
	require.NoError(t, err)
	require.NoError(t, exporter.Shutdown(context.Background()))
	assert.Nil(t, tail[1], "the caller's spare capacity is left untouched")
}
