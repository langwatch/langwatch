package otelhttp

import (
	"bytes"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	oteltrace "go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

const defaultTracerName = "github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"

// Config configures a Tracer. Provider packages fill it in with their gen_ai
// provider name and their shape Extractors.
type Config struct {
	// TracerName is the instrumentation scope name (defaults to the otelhttp scope).
	TracerName string
	// TracerVersion is the instrumentation scope version.
	TracerVersion string
	// Provider is recorded as gen_ai.provider.name (e.g. semconv.GenAIProviderNameOpenAI).
	Provider attribute.KeyValue
	// DataCapture gates input/output content recording. Defaults to DataCaptureAll.
	DataCapture langwatch.DataCaptureMode
	// TracerProvider supplies the tracer; defaults to the global provider.
	TracerProvider oteltrace.TracerProvider
	// Extractors are tried in order to recognise request/response shapes. The
	// last one should be a permissive fallback.
	Extractors []Extractor
	// OperationAttrs optionally derives extra request attributes (e.g.
	// gen_ai.operation.name) from the request URL/path.
	OperationAttrs func(req *http.Request) []attribute.KeyValue
	// StreamContentType is the response Content-Type prefix that signals a
	// streamed response. Defaults to "text/event-stream". NDJSON streamers (e.g.
	// the Ollama native API) set this to "application/x-ndjson".
	StreamContentType string
	// Framing controls how streamed response lines are parsed: FramingSSE (the
	// default) for `data: <json>` Server-Sent Events terminated by [DONE], or
	// FramingNDJSON for newline-delimited JSON where each line is the payload.
	Framing StreamFraming
}

// StreamFraming describes how a streamed response body is line-framed.
type StreamFraming int

const (
	// FramingSSE is Server-Sent Events: each event is a `data: <json>` line and
	// the stream is terminated by a `data: [DONE]` sentinel. The default.
	FramingSSE StreamFraming = iota
	// FramingNDJSON is newline-delimited JSON: each non-empty line is itself the
	// JSON payload, and the stream ends at EOF (no sentinel).
	FramingNDJSON
)

// Tracer traces LLM HTTP calls for one provider configuration.
type Tracer struct {
	cfg     Config
	capture langwatch.DataCaptureMode
	tracer  *langwatch.LangWatchTracer
}

// New builds a Tracer from cfg.
func New(cfg Config) *Tracer {
	name := cfg.TracerName
	if name == "" {
		name = defaultTracerName
	}
	capture := cfg.DataCapture
	if capture == "" {
		capture = langwatch.DataCaptureAll
	}
	provider := cfg.TracerProvider
	if provider == nil {
		provider = otel.GetTracerProvider()
	}
	opts := []oteltrace.TracerOption{oteltrace.WithSchemaURL(semconv.SchemaURL)}
	if cfg.TracerVersion != "" {
		opts = append(opts, oteltrace.WithInstrumentationVersion(cfg.TracerVersion))
	}
	return &Tracer{cfg: cfg, capture: capture, tracer: langwatch.TracerFromProvider(provider, name, opts...)}
}

// RoundTripper wraps base with tracing, for SDKs whose client takes an
// *http.Client / http.RoundTripper (go-openai, google genai, ollama, …). When
// base is nil, http.DefaultTransport is used.
func (t *Tracer) RoundTripper(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return t.Handle(req, base.RoundTrip)
	})
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

// Handle traces a single request/response. next performs the downstream round
// trip. Its signature matches the Stainless option.MiddlewareNext, so a provider
// using option.WithMiddleware can forward directly:
//
//	option.WithMiddleware(func(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
//	    return tr.Handle(req, next)
//	})
func (t *Tracer) Handle(req *http.Request, next func(*http.Request) (*http.Response, error)) (*http.Response, error) {
	operation := path.Base(req.URL.Path)
	providerName := t.cfg.Provider.Value.AsString()
	spanName := providerName + "." + operation

	attrs := []attribute.KeyValue{
		semconv.HTTPRequestMethodKey.String(req.Method),
		semconv.ServerAddressKey.String(req.URL.Hostname()),
		semconv.URLPathKey.String(req.URL.Path),
	}
	if t.cfg.Provider.Valid() {
		attrs = append(attrs, t.cfg.Provider)
	}
	if t.cfg.OperationAttrs != nil {
		attrs = append(attrs, t.cfg.OperationAttrs(req)...)
	}

	ctx, span := t.tracer.Start(req.Context(), spanName,
		oteltrace.WithAttributes(attrs...),
		oteltrace.WithSpanKind(oteltrace.SpanKindClient),
	)
	// Mark the request start so the streaming body can record TTFT (the latency
	// to the first streamed chunk) relative to it.
	start := time.Now()

	// Read + restore the request body and pick its extractor, deferring the
	// attribute extraction off the request's critical path. ExtractRequest also
	// reports whether the request asked for a streamed response. We record
	// gen_ai.request.stream for every request, combining that body-shape hint with
	// whether the base actually took the streaming response path — providers like
	// Gemini signal streaming via the URL action rather than a body field, so the
	// extractor hint alone would miss it.
	reqRaw, reqExtractor := t.readRequest(req)
	streamingResp := false
	recordRequest := func() {
		if reqExtractor != nil {
			streaming := reqExtractor.ExtractRequest(span, reqRaw, t.capture)
			span.SetGenAIRequestStream(streaming || streamingResp)
		}
	}

	// The span ends here unless a capturing response body takes ownership of it.
	bodyOwnsSpan := false
	defer func() {
		if !bodyOwnsSpan {
			span.End()
		}
	}()

	resp, err := next(req.WithContext(ctx))
	if err != nil {
		recordRequest()
		span.SetStatus(codes.Error, err.Error())
		span.RecordError(err)
		if resp != nil {
			span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(resp.StatusCode))
		}
		return resp, err
	}
	if resp == nil {
		recordRequest()
		return resp, nil
	}

	span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(resp.StatusCode))
	if resp.StatusCode >= 400 {
		recordRequest()
		span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
		return resp, nil
	}
	span.SetStatus(codes.Ok, "")

	if resp.Body == nil || resp.Body == http.NoBody {
		recordRequest()
		return resp, nil
	}

	contentType := resp.Header.Get("Content-Type")

	streamContentType := t.cfg.StreamContentType
	if streamContentType == "" {
		streamContentType = "text/event-stream"
	}
	if strings.HasPrefix(contentType, streamContentType) {
		// The response is a stream, so this was a streaming request regardless of
		// what the request body said (Gemini, for one, only signals it in the URL).
		streamingResp = true
		acc := t.streamAccumulatorFor(reqExtractor)
		resp.Body = newStreamingCaptureBody(resp.Body, span, acc, t.capture, recordRequest, t.cfg.Framing, start)
		bodyOwnsSpan = true
		return resp, nil
	}

	if !strings.HasPrefix(contentType, "application/json") {
		recordRequest()
		return resp, nil
	}

	resp.Body = newCapturingBody(resp.Body, func(captured []byte, truncated bool) {
		recordRequest()
		if !truncated {
			if e := selectResponseExtractor(t.cfg.Extractors, PeekObjectField(captured), contentType); e != nil {
				e.ExtractNonStreaming(span, captured, t.capture)
			}
		}
		span.End()
	})
	bodyOwnsSpan = true
	return resp, nil
}

// readRequest reads and restores the request body and selects its extractor,
// WITHOUT extracting attributes (that is deferred to span completion).
func (t *Tracer) readRequest(req *http.Request) ([]byte, Extractor) {
	if req.Body == nil || req.Body == http.NoBody {
		return nil, nil
	}
	raw, err := io.ReadAll(req.Body)
	if err != nil {
		logf("failed to read request body: %v", err)
		return nil, nil
	}
	req.Body = io.NopCloser(bytes.NewReader(raw))
	body, _ := ParseBody(raw)
	return raw, selectRequestExtractor(t.cfg.Extractors, body, req.URL.Path)
}

func (t *Tracer) streamAccumulatorFor(reqExtractor Extractor) StreamAccumulator {
	if reqExtractor == nil {
		return NoopAccumulator{}
	}
	return reqExtractor.NewStreamAccumulator()
}
