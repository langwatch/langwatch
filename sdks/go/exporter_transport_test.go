package langwatch

import (
	"compress/gzip"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/langwatch/sdks/go/internal/testutil"
)

// otlpReceiver stands in for LangWatch's /api/otel/v1/traces route,
// decoding each gzipped OTLP/protobuf body it receives.
type otlpReceiver struct {
	t        *testing.T
	mu       sync.Mutex
	paths    []string
	headers  []http.Header
	received []testutil.ReceivedSpan
}

func (r *otlpReceiver) ServeHTTP(w http.ResponseWriter, req *http.Request) {
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
	if !assert.NoError(r.t, err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	spans, err := testutil.ReadOTLPSpans(raw)
	if !assert.NoError(r.t, err) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	r.mu.Lock()
	r.paths = append(r.paths, req.URL.Path)
	r.headers = append(r.headers, req.Header.Clone())
	r.received = append(r.received, spans...)
	r.mu.Unlock()
	w.WriteHeader(http.StatusOK)
}

// spans returns every exported span across the received bodies.
func (r *otlpReceiver) spans() []testutil.ReceivedSpan {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]testutil.ReceivedSpan(nil), r.received...)
}

func startReceiver(t *testing.T) (*otlpReceiver, string) {
	t.Helper()
	rec := &otlpReceiver{t: t}
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)
	return rec, srv.URL
}

func TestNewExporter_DefaultTransportSendsOTLPProtobuf(t *testing.T) {
	rec, endpoint := startReceiver(t)

	exporter, err := NewExporter(context.Background(),
		WithAPIKey("pat-lw-secret"),
		WithProjectID("project-9"),
		WithEndpoint(endpoint),
	)
	require.NoError(t, err)
	defer exporter.Shutdown(context.Background())

	require.NoError(t, exporter.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{
		richSpanStub("llm.chat", "openai", "llm").Snapshot(),
	}))

	require.Len(t, rec.headers, 1)
	assert.Equal(t, TracesPath, rec.paths[0])
	h := rec.headers[0]
	assert.Equal(t, "application/x-protobuf", h.Get("Content-Type"))
	assert.Equal(t, "gzip", h.Get("Content-Encoding"))
	assert.Equal(t, "Bearer pat-lw-secret", h.Get("Authorization"))
	assert.Equal(t, "project-9", h.Get("X-Project-Id"))
	assert.Equal(t, "langwatch-sdk-go", h.Get("X-Langwatch-Sdk-Name"))
	assert.Equal(t, "go", h.Get("X-Langwatch-Sdk-Language"))
	assert.Equal(t, Version, h.Get("X-Langwatch-Sdk-Version"))

	spans := rec.spans()
	require.Len(t, spans, 1)
	assert.Equal(t, "llm.chat", spans[0].Name)
	assert.Contains(t, spans[0].AttributeKeys, "langwatch.input")
}

func TestNewExporter_DefaultTransportAppliesFiltersAndDataCapture(t *testing.T) {
	rec, endpoint := startReceiver(t)

	exporter, err := NewDefaultExporter(context.Background(),
		WithAPIKey("sk-lw-test"),
		WithEndpoint(endpoint),
		WithDataCapture(DataCaptureNone),
	)
	require.NoError(t, err)
	defer exporter.Shutdown(context.Background())

	require.NoError(t, exporter.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{
		richSpanStub("GET /api/users", "net/http", "span").Snapshot(),
		richSpanStub("llm.chat", "openai", "llm").Snapshot(),
	}))

	spans := rec.spans()
	require.Len(t, spans, 1, "the HTTP span is filtered before it is encoded")
	assert.Equal(t, "llm.chat", spans[0].Name)
	keys := spans[0].AttributeKeys
	assert.NotContains(t, keys, "langwatch.input")
	assert.NotContains(t, keys, "langwatch.output")
}

func TestNewExporter_WithCompressionOff(t *testing.T) {
	t.Setenv("LANGWATCH_API_KEY", "")
	rec, endpoint := startReceiver(t)

	exporter, err := NewExporter(context.Background(),
		WithEndpoint(endpoint),
		WithCompression(false),
		WithHTTPClient(&http.Client{}),
	)
	require.NoError(t, err)
	defer exporter.Shutdown(context.Background())

	require.NoError(t, exporter.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{
		richSpanStub("llm.chat", "openai", "llm").Snapshot(),
	}))
	require.Len(t, rec.headers, 1)
	assert.Empty(t, rec.headers[0].Get("Content-Encoding"))
	assert.Empty(t, rec.headers[0].Get("Authorization"), "no API key, no auth header")
}

func TestNewExporter_WithTransport(t *testing.T) {
	t.Run("the transport receives the traces URL and headers and is wrapped", func(t *testing.T) {
		mock := testutil.NewMockExporter()
		var gotURL string
		var gotHeaders map[string]string

		exporter, err := NewExporter(context.Background(),
			WithAPIKey("sk-lw-test"),
			WithEndpoint("https://example.test/base"),
			WithFilters(ExcludeHTTPRequests()),
			WithTransport(func(_ context.Context, endpointURL string, headers map[string]string) (sdktrace.SpanExporter, error) {
				gotURL, gotHeaders = endpointURL, headers
				return mock, nil
			}),
		)
		require.NoError(t, err)

		assert.Equal(t, "https://example.test/base"+TracesPath, gotURL)
		assert.Equal(t, "Bearer sk-lw-test", gotHeaders["Authorization"])
		assert.Equal(t, "langwatch-sdk-go", gotHeaders["x-langwatch-sdk-name"])

		require.NoError(t, exporter.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{
			testutil.CreateMockSpan("GET /api", "net/http"),
			testutil.CreateMockSpan("llm.chat", "openai"),
		}))
		require.Len(t, mock.GetSpans(), 1)
		assert.Equal(t, "llm.chat", mock.GetSpans()[0].Name())
	})

	t.Run("a transport returning no exporter and no error is refused", func(t *testing.T) {
		exporter, err := NewExporter(context.Background(),
			WithTransport(func(context.Context, string, map[string]string) (sdktrace.SpanExporter, error) {
				return nil, nil
			}),
		)
		require.ErrorIs(t, err, ErrNilTransportExporter)
		assert.Nil(t, exporter)
	})

	t.Run("a transport error is returned", func(t *testing.T) {
		boom := errors.New("boom")
		exporter, err := NewExporter(context.Background(),
			WithTransport(func(context.Context, string, map[string]string) (sdktrace.SpanExporter, error) {
				return nil, boom
			}),
		)
		require.ErrorIs(t, err, boom)
		assert.Nil(t, exporter)
	})
}
