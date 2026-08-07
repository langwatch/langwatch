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

	langwatch "github.com/langwatch/langwatch/sdks/go"
)

// fakeExtractor records that it was invoked and sets marker attributes.
type fakeExtractor struct {
	streaming     bool
	matchedReq    bool
	matchedResp   bool
	reqCalled     *bool
	nonStreamHits *int
	// acc, when set, is handed to every stream instead of a fresh accumulator, so
	// a test can inspect what the stream did to it.
	acc *fakeAccumulator
}

func (f *fakeExtractor) Name() string                           { return "fake" }
func (f *fakeExtractor) MatchesRequest(JSONObject, string) bool { return f.matchedReq }
func (f *fakeExtractor) MatchesResponse(string, string) bool    { return f.matchedResp }
func (f *fakeExtractor) NewStreamAccumulator() StreamAccumulator {
	if f.acc != nil {
		return f.acc
	}
	return &fakeAccumulator{}
}
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
		// Presence is asserted first: a map miss yields the zero attribute.Value,
		// whose AsBool() is also false, so the value check alone cannot fail.
		stream, hasStream := attrs["gen_ai.request.stream"]
		require.True(t, hasStream, "gen_ai.request.stream must be recorded")
		assert.False(t, stream.AsBool())
		_, hasTTFT := attrs["gen_ai.response.time_to_first_chunk"]
		assert.False(t, hasTTFT, "TTFT must not be recorded for a non-streaming response")
	})
}

func TestHandleStreaming(t *testing.T) {
	t.Run("it reconstructs an SSE stream as the consumer reads it", func(t *testing.T) {
		acc := &fakeAccumulator{}
		ext := &fakeExtractor{matchedReq: true, streaming: true, acc: acc}
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
		assert.True(t, acc.finished, "the accumulator was finished exactly once by the streaming body")
		attrs := attrMap(spans[0])
		assert.Equal(t, "fake-stream-model", attrs["gen_ai.response.model"].AsString())
		// A streaming request records gen_ai.request.stream == true and a TTFT.
		stream, hasStream := attrs["gen_ai.request.stream"]
		require.True(t, hasStream, "gen_ai.request.stream must be recorded")
		assert.True(t, stream.AsBool())
		ttft, hasTTFT := attrs["gen_ai.response.time_to_first_chunk"]
		require.True(t, hasTTFT, "TTFT must be recorded for a streamed response")
		assert.GreaterOrEqual(t, ttft.AsFloat64(), 0.0)
	})
}

// chunkedErrorBody returns each chunk together with io.EOF, the shape that makes
// a capturing body complete and then be read again by a consumer that keeps
// going. A real body does this whenever it delivers its last bytes and its error
// in one Read.
type chunkedErrorBody struct {
	chunks []string
	next   int
}

func (b *chunkedErrorBody) Read(p []byte) (int, error) {
	if b.next >= len(b.chunks) {
		return 0, io.EOF
	}
	n := copy(p, b.chunks[b.next])
	b.next++
	return n, io.EOF
}

func (b *chunkedErrorBody) Close() error { return nil }

func TestCapturingBodyPooledBufferLifetime(t *testing.T) {
	t.Run("a read after completion cannot reach the pooled buffer", func(t *testing.T) {
		completions := 0
		var captured string
		cb := newCapturingBody(&chunkedErrorBody{chunks: []string{"first", "late"}},
			func(b []byte, _ bool) {
				completions++
				captured = string(b)
			})

		buf := make([]byte, 32)
		n, err := cb.Read(buf)
		require.Equal(t, io.EOF, err)
		require.Equal(t, "first", string(buf[:n]))
		assert.Equal(t, 1, completions)
		assert.Equal(t, "first", captured)

		// The buffer went back to the pool inside complete(), so another request
		// may already own it. The finished body must have dropped its reference
		// rather than keep appending to someone else's capture.
		require.Nil(t, cb.cap.buf, "the completed body must not still hold the pooled buffer")

		n, err = cb.Read(buf)
		require.Equal(t, io.EOF, err)
		assert.Equal(t, "late", string(buf[:n]), "the consumer still gets its bytes")
		assert.Equal(t, 1, completions, "completion fires exactly once")
		assert.Equal(t, "first", captured, "the late bytes never reach the capture")

		require.NoError(t, cb.Close())
	})
}

func TestHandleOversizedRequestBody(t *testing.T) {
	t.Run("it forwards an over-cap request body intact and skips extraction", func(t *testing.T) {
		reqCalled := false
		ext := &fakeExtractor{matchedReq: true, matchedResp: true, reqCalled: &reqCalled}
		tr, exp := newTracer(t, ext)

		// A chat request with base64 images or a long document context reaches this
		// size easily; buffering all of it on the request path is the failure mode.
		oversized := `{"model":"m","prompt":"` + strings.Repeat("x", maxCaptureBytes) + `"}`
		req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/chat/completions", strings.NewReader(oversized))

		var forwarded []byte
		resp, err := tr.Handle(req, func(r *http.Request) (*http.Response, error) {
			forwarded, _ = io.ReadAll(r.Body)
			h := http.Header{}
			h.Set("Content-Type", "application/json")
			return &http.Response{StatusCode: http.StatusOK, Header: h, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
		})
		require.NoError(t, err)
		_, err = io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())

		assert.Equal(t, oversized, string(forwarded), "the body still reaches the provider byte-for-byte")
		assert.False(t, reqCalled, "no extraction is attempted on an over-cap body")
		require.Len(t, exp.GetSpans(), 1, "the span is still recorded")
	})

	t.Run("a body exactly on the cap is still extracted", func(t *testing.T) {
		reqCalled := false
		ext := &fakeExtractor{matchedReq: true, reqCalled: &reqCalled}
		tr, _ := newTracer(t, ext)

		const envelope = `{"model":"m","prompt":""}`
		atCap := `{"model":"m","prompt":"` + strings.Repeat("x", maxCaptureBytes-len(envelope)) + `"}`
		require.Len(t, atCap, maxCaptureBytes)

		req := httptest.NewRequest(http.MethodPost, "https://api.test/v1/chat/completions", strings.NewReader(atCap))
		resp, err := tr.Handle(req, func(r *http.Request) (*http.Response, error) {
			_, _ = io.ReadAll(r.Body)
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: http.NoBody}, nil
		})
		require.NoError(t, err)
		require.NotNil(t, resp)

		assert.True(t, reqCalled, "a body on the cap is parsed as usual")
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
		assert.False(t, RequestStreams([]byte(`not json`)))
	})

	t.Run("ParseBody rejects a JSON null body", func(t *testing.T) {
		// `null` unmarshals into a map without error and leaves it nil. Reporting
		// success would hand the shape sniffers a nil map, which answers every
		// HasKey/GetString with a zero value and picks the wrong extractor.
		body, ok := ParseBody([]byte(`null`))
		assert.False(t, ok, "a JSON null is not a JSON object")
		assert.Nil(t, body)
	})

	t.Run("GetInt64 does not truncate values beyond the int32 range", func(t *testing.T) {
		// Nanosecond durations pass through here: a 3-second call is 3e9, past the
		// int32 range that GetInt would truncate to on a 32-bit build.
		body, ok := ParseBody([]byte(`{"total_duration":3000000000}`))
		require.True(t, ok)
		v, ok := GetInt64(body, "total_duration")
		require.True(t, ok)
		assert.Equal(t, int64(3000000000), v)

		_, ok = GetInt64(body, "missing")
		assert.False(t, ok)
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
