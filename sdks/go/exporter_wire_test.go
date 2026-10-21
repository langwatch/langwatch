package langwatch

import (
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

// protobufReceiver stands in for LangWatch's /api/otel/v1/traces route.
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
		if !assert.NoError(r.t, err) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		body = zr
	}
	raw, err := io.ReadAll(body)
	var msg collectortrace.ExportTraceServiceRequest
	if !assert.NoError(r.t, err) || !assert.NoError(r.t, proto.Unmarshal(raw, &msg)) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	r.mu.Lock()
	r.headers = append(r.headers, req.Header.Clone())
	r.requests = append(r.requests, &msg)
	r.mu.Unlock()
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
}

func exportOneSpan(t *testing.T) *protobufReceiver {
	t.Helper()
	rec := &protobufReceiver{t: t}
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)

	exporter, err := NewExporter(context.Background(), WithAPIKey("sk-lw-test"), WithEndpoint(srv.URL))
	require.NoError(t, err)
	require.NoError(t, exporter.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{
		tracetest.SpanStub{Name: "llm.chat"}.Snapshot(),
	}))
	require.NoError(t, exporter.Shutdown(context.Background()))
	require.Len(t, rec.requests, 1)
	return rec
}

// @scenario "The Go SDK sends gzipped protobuf by default"
func TestNewExporter_SendsGzippedProtobufByDefault(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_COMPRESSION", "")
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", "")

	rec := exportOneSpan(t)

	assert.Equal(t, "application/x-protobuf", rec.headers[0].Get("Content-Type"))
	assert.Equal(t, "gzip", rec.headers[0].Get("Content-Encoding"))
	spans := rec.requests[0].GetResourceSpans()[0].GetScopeSpans()[0].GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "llm.chat", spans[0].GetName())
}

// @scenario "The Go SDK leaves compression to the OTel variables when they are set"
func TestNewExporter_LeavesCompressionToTheOTelVariables(t *testing.T) {
	for _, name := range []string{"OTEL_EXPORTER_OTLP_COMPRESSION", "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("OTEL_EXPORTER_OTLP_COMPRESSION", "")
			t.Setenv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", "")
			t.Setenv(name, "none")

			rec := exportOneSpan(t)

			assert.Equal(t, "application/x-protobuf", rec.headers[0].Get("Content-Type"))
			assert.Empty(t, rec.headers[0].Get("Content-Encoding"))
		})
	}
}
