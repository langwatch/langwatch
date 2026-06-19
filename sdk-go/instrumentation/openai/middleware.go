package openai

import (
	"bytes"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	oaioption "github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
	instrumentationVersion = "0.0.1"
)

// Middleware sets up a handler to start tracing the requests made to OpenAI by
// the OpenAI library. It dispatches by request/response *shape* (see
// shapeExtractor) rather than by URL path, so it traces chat completions, the
// Responses API, embeddings and any other OpenAI-compatible endpoint uniformly.
//
// Tracing is designed to add negligible latency and memory: the response body is
// never pre-buffered or restored — it is *passed through* to the caller while a
// bounded copy is captured for attribute extraction, and parsing happens off the
// request/response critical path once the body is drained. See bodycapture.go.
func Middleware(name string, opts ...Option) oaioption.Middleware {
	cfg := config{
		genAIProvider: semconv.GenAIProviderNameOpenAI, // Default to "openai"
		dataCapture:   langwatch.DataCaptureAll,        // Capture input + output by default
	}
	for _, opt := range opts {
		opt.apply(&cfg)
	}
	if cfg.tracerProvider == nil {
		cfg.tracerProvider = otel.GetTracerProvider()
	}
	tracerOpts := []trace.TracerOption{
		trace.WithInstrumentationVersion(instrumentationVersion),
		trace.WithSchemaURL(semconv.SchemaURL),
	}

	tracer := langwatch.TracerFromProvider(cfg.tracerProvider, tracerName, tracerOpts...)

	if cfg.propagators == nil {
		cfg.propagators = otel.GetTextMapPropagator()
	}

	return func(req *http.Request, next oaioption.MiddlewareNext) (*http.Response, error) {
		operation := path.Base(req.URL.Path)
		genAISystemName := cfg.genAIProvider.Value.AsString()
		spanName := genAISystemName + "." + operation

		genAIOperation := getGenAIOperationFromPath(req.URL.Path)

		ctx, span := tracer.Start(req.Context(), spanName,
			trace.WithAttributes(
				semconv.HTTPRequestMethodKey.String(req.Method),
				semconv.ServerAddressKey.String(req.URL.Hostname()),
				semconv.URLPathKey.String(req.URL.Path),
				cfg.genAIProvider,
				genAIOperation,
			),
			trace.WithSpanKind(trace.SpanKindClient),
		)
		// Mark the request start so the streaming body can record TTFT (the latency
		// to the first streamed chunk) relative to it.
		start := time.Now()

		// Read + restore the (small) request body and pick its shape extractor,
		// but defer the attribute extraction off the request's critical path — the
		// request is dispatched before we parse it. recordRequest runs once, at
		// span completion. extractRequest also reports whether the request asked
		// for a streamed response, recorded as gen_ai.request.stream.
		reqRaw, reqExtractor := readRequest(req)
		recordRequest := func() {
			if reqExtractor != nil {
				streaming := reqExtractor.extractRequest(span, reqRaw, cfg.dataCapture)
				span.SetGenAIRequestStream(streaming)
			}
		}

		// The span is ended here unless a capturing response body takes ownership
		// of it (streaming, or a buffered JSON body parsed on drain).
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

		// Streaming: hand span ownership to a byte-exact pass-through reader that
		// reconstructs the stream from the client's own reads.
		if strings.HasPrefix(contentType, "text/event-stream") {
			acc := streamAccumulatorFor(reqExtractor)
			resp.Body = newStreamingCaptureBody(resp.Body, span, acc, cfg.dataCapture, recordRequest, start)
			bodyOwnsSpan = true
			return resp, nil
		}

		// Non-JSON, non-stream (e.g. audio bytes): nothing to parse.
		if !strings.HasPrefix(contentType, "application/json") {
			recordRequest()
			return resp, nil
		}

		// Non-streaming JSON: tee-capture the body and parse it once the client has
		// finished reading, off the response's critical path.
		resp.Body = newCapturingBody(resp.Body, func(captured []byte, truncated bool) {
			recordRequest()
			if !truncated {
				extractor := selectResponseExtractor(peekObjectField(captured), contentType)
				extractor.extractNonStreaming(span, captured, cfg.dataCapture)
			}
			span.End()
		})
		bodyOwnsSpan = true
		return resp, nil
	}
}

// readRequest reads and restores the request body and selects the shape
// extractor for it, WITHOUT extracting attributes (that is deferred to span
// completion). Returns nil, nil when there is no body.
func readRequest(req *http.Request) ([]byte, shapeExtractor) {
	if req.Body == nil || req.Body == http.NoBody {
		return nil, nil
	}

	raw, err := io.ReadAll(req.Body)
	if err != nil {
		logError("Failed to read OpenAI request body: %v", err)
		return nil, nil
	}
	// Restore the body (a bytes.Reader, no extra copy) so the transport can send it.
	req.Body = io.NopCloser(bytes.NewReader(raw))

	// Parse once for cheap shape sniffing; the matched extractor re-parses into
	// its typed struct when it runs.
	body, _ := parseBody(raw)
	return raw, selectRequestExtractor(body, req.URL.Path)
}

// streamAccumulatorFor returns the stream accumulator for the request's shape,
// falling back to the generic accumulator.
func streamAccumulatorFor(reqExtractor shapeExtractor) streamAccumulator {
	if reqExtractor == nil {
		return genericExtractor{}.newStreamAccumulator()
	}
	return reqExtractor.newStreamAccumulator()
}

// getGenAIOperationFromPath determines the GenAI operation type based on the OpenAI API endpoint path
func getGenAIOperationFromPath(urlPath string) attribute.KeyValue {
	// OpenAI API paths typically follow: /v1/{operation} or /v1/{operation}/...
	// Azure OpenAI paths follow: /openai/deployments/{deployment-id}/{operation}
	pathSegments := strings.Split(strings.Trim(urlPath, "/"), "/")

	var operationSegment string

	for i, segment := range pathSegments {
		if segment == "deployments" && i+2 < len(pathSegments) {
			operationSegment = pathSegments[i+2]
			break
		}
	}

	if operationSegment == "" && len(pathSegments) >= 2 && pathSegments[0] == "v1" {
		operationSegment = pathSegments[1]
	}

	switch operationSegment {
	case "chat":
		return semconv.GenAIOperationNameChat
	case "completions":
		return semconv.GenAIOperationNameTextCompletion
	case "embeddings":
		return semconv.GenAIOperationNameEmbeddings
	case "responses":
		return semconv.GenAIOperationNameKey.String("responses")
	case "audio":
		return semconv.GenAIOperationNameKey.String("audio")
	case "images":
		return semconv.GenAIOperationNameKey.String("images")
	default:
		if operationSegment != "" {
			return semconv.GenAIOperationNameKey.String(operationSegment)
		}
		return semconv.GenAIOperationNameChat
	}
}
