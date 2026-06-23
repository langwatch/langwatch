package otelhttp

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// fakeExtractor records that it was invoked and sets marker attributes.
type fakeExtractor struct {
	streaming     bool
	matchedReq    bool
	matchedResp   bool
	reqCalled     *bool
	nonStreamHits *int
}

func (f *fakeExtractor) Name() string                            { return "fake" }
func (f *fakeExtractor) MatchesRequest(JSONObject, string) bool  { return f.matchedReq }
func (f *fakeExtractor) MatchesResponse(string, string) bool     { return f.matchedResp }
func (f *fakeExtractor) NewStreamAccumulator() StreamAccumulator { return &fakeAccumulator{} }
func (f *fakeExtractor) ExtractRequest(span *langwatch.Span, _ []byte, _ langwatch.DataCaptureMode) bool {
	if f.reqCalled != nil {
		*f.reqCalled = true
	}
	span.SetRequestModel("fake-model")
	return f.streaming
}
func (f *fakeExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, _ langwatch.DataCaptureMode) {
	if f.nonStreamHits != nil {
		*f.nonStreamHits++
	}
	span.SetOutputText(string(raw))
}

type fakeAccumulator struct{ finished bool }

func (a *fakeAccumulator) Consume(string)           {}
func (a *fakeAccumulator) IsTerminal(s string) bool { return s == "[DONE]" }
func (a *fakeAccumulator) Finish(span *langwatch.Span, _ langwatch.DataCaptureMode) {
	a.finished = true
	span.SetResponseModel("fake-stream-model")
}

func newTracer(t *testing.T, extractors ...Extractor) (*Tracer, *tracetest.InMemoryExporter) {
	t.Helper()
	exp := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exp)))
	tr := New(Config{
		Provider:       attribute.String("gen_ai.provider.name", "fake"),
		TracerProvider: provider,
		Extractors:     extractors,
	})
	return tr, exp
}

func jsonResponse(body string) func(*http.Request) (*http.Response, error) {
	return func(*http.Request) (*http.Response, error) {
		h := http.Header{}
		h.Set("Content-Type", "application/json")
		return &http.Response{StatusCode: 200, Header: h, Body: io.NopCloser(strings.NewReader(body))}, nil
	}
}

func attrMap(span tracetest.SpanStub) map[attribute.Key]attribute.Value {
	m := map[attribute.Key]attribute.Value{}
	for _, kv := range span.Attributes {
		m[kv.Key] = kv.Value
	}
	return m
}

func TestHandleNonStreaming(t *testing.T) {
	t.Run("it records request and response attributes once the body is read", func(t *testing.T) {
		reqCalled := false
		hits := 0
		ext := &fakeExtractor{matchedReq: true, matchedResp: true, reqCalled: &reqCalled, nonStreamHits: &hits}
		tr, exp := newTracer(t, ext)

		req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/chat/completions", strings.NewReader(`{"model":"m"}`))
		resp, err := tr.Handle(req, jsonResponse(`{"object":"chat.completion"}`))
		require.NoError(t, err)

		// The consumer reads the body at full speed; capture + extraction fire on drain.
		got, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		assert.Equal(t, `{"object":"chat.completion"}`, string(got), "body passes through byte-for-byte")

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.True(t, reqCalled, "request extractor ran")
		assert.Equal(t, 1, hits, "response extractor ran once")
		attrs := attrMap(spans[0])
		assert.Equal(t, "fake-model", attrs["gen_ai.request.model"].AsString())
		assert.Equal(t, codes.Ok, spans[0].Status.Code)
		assert.Equal(t, int64(200), attrs["http.response.status_code"].AsInt64())
		// A non-streaming request records gen_ai.request.stream == false and no TTFT.
		assert.False(t, attrs["gen_ai.request.stream"].AsBool())
		_, hasTTFT := attrs["gen_ai.response.time_to_first_chunk"]
		assert.False(t, hasTTFT, "TTFT must not be recorded for a non-streaming response")
	})
}

func TestHandleStreaming(t *testing.T) {
	t.Run("it reconstructs an SSE stream as the consumer reads it", func(t *testing.T) {
		ext := &fakeExtractor{matchedReq: true, streaming: true}
		tr, exp := newTracer(t, ext)

		req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/chat/completions", strings.NewReader(`{"stream":true}`))
		resp, err := tr.Handle(req, func(*http.Request) (*http.Response, error) {
			h := http.Header{}
			h.Set("Content-Type", "text/event-stream")
			return &http.Response{StatusCode: 200, Header: h, Body: io.NopCloser(strings.NewReader("data: {}\n\ndata: [DONE]\n\n"))}, nil
		})
		require.NoError(t, err)
		_, err = io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())

		spans := exp.GetSpans()
		require.Len(t, spans, 1, "span ended exactly once via the streaming body")
		attrs := attrMap(spans[0])
		assert.Equal(t, "fake-stream-model", attrs["gen_ai.response.model"].AsString())
		// A streaming request records gen_ai.request.stream == true and a TTFT.
		assert.True(t, attrs["gen_ai.request.stream"].AsBool())
		ttft, hasTTFT := attrs["gen_ai.response.time_to_first_chunk"]
		require.True(t, hasTTFT, "TTFT must be recorded for a streamed response")
		assert.GreaterOrEqual(t, ttft.AsFloat64(), 0.0)
	})
}

func TestHandleError(t *testing.T) {
	t.Run("a transport error is recorded on the span", func(t *testing.T) {
		tr, exp := newTracer(t, &fakeExtractor{matchedReq: true})
		req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/x", strings.NewReader(`{}`))
		_, err := tr.Handle(req, func(*http.Request) (*http.Response, error) { return nil, errors.New("boom") })
		require.Error(t, err)

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Error, spans[0].Status.Code)
		assert.NotEmpty(t, spans[0].Events)
	})
}

func TestRoundTripper(t *testing.T) {
	t.Run("it traces a real http.Client round trip", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"object":"chat.completion"}`)
		}))
		defer srv.Close()

		ext := &fakeExtractor{matchedReq: true, matchedResp: true}
		tr, exp := newTracer(t, ext)
		client := &http.Client{Transport: tr.RoundTripper(nil)}

		resp, err := client.Post(srv.URL, "application/json", strings.NewReader(`{"model":"m"}`))
		require.NoError(t, err)
		_, err = io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())

		assert.Len(t, exp.GetSpans(), 1)
	})
}

func TestHelpers(t *testing.T) {
	t.Run("ParseBody and discriminators", func(t *testing.T) {
		body, ok := ParseBody([]byte(`{"messages":[],"stream":true,"n":2}`))
		require.True(t, ok)
		assert.True(t, HasKey(body, "messages"))
		assert.False(t, HasKey(body, "missing"))
		n, ok := GetInt(body, "n")
		assert.True(t, ok)
		assert.Equal(t, 2, n)

		_, ok = ParseBody([]byte(`not json`))
		assert.False(t, ok)

		assert.Equal(t, "response", PeekObjectField([]byte(`{"object":"response"}`)))
		assert.True(t, RequestStreams([]byte(`{"stream":true}`)))
		assert.False(t, RequestStreams([]byte(`{"stream":false}`)))
	})

	t.Run("ToChatMessages converts and falls back", func(t *testing.T) {
		msgs, ok := ToChatMessages([]map[string]any{{"role": "user", "content": "hi"}})
		require.True(t, ok)
		require.Len(t, msgs, 1)
		assert.Equal(t, langwatch.ChatRoleUser, msgs[0].Role)

		_, ok = ToChatMessages("not messages")
		assert.False(t, ok)
	})
}
