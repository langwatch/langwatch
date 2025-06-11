package openai

import (
	"net/http"
	"path"
	"strings"

	oaioption "github.com/openai/openai-go/option"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
	"go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
	instrumentationVersion = "0.0.1"
)

// Middleware sets up a handler to start tracing the requests made to OpenAI by the
// OpenAI library.
func Middleware(name string, opts ...Option) oaioption.Middleware {
	cfg := config{
		genAISystem: semconv.GenAISystemOpenai, // Default to "openai"
		slogger:             defaultLogger, // zero-noise default
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

	tracer := langwatch.Tracer(tracerName, tracerOpts...)

	if cfg.propagators == nil {
		cfg.propagators = otel.GetTextMapPropagator()
	}

	return func(req *http.Request, next oaioption.MiddlewareNext) (*http.Response, error) {
		operation := path.Base(req.URL.Path)
		genAISystemName := cfg.genAISystem.Value.AsString()
		spanName := genAISystemName + "." + operation

		genAIOperation := getGenAIOperationFromPath(req.URL.Path)

		ctx, span := tracer.Start(req.Context(), spanName,
			trace.WithAttributes(
				semconv.HTTPRequestMethodKey.String(req.Method),
				semconv.ServerAddressKey.String(req.URL.Hostname()),
				semconv.URLPathKey.String(req.URL.Path),
				cfg.genAISystem,
				genAIOperation,
			),
			trace.WithSpanKind(trace.SpanKindClient),
		)

		// Use a flag to control whether defer should end the span
		// For streaming responses, the span will be ended by the response processor
		shouldEndSpan := true
		defer func() {
			if shouldEndSpan {
				span.End()
			}
		}()

		requestProcessor := NewRequestProcessor(cfg.recordInput, genAISystemName)
		responseProcessor := NewResponseProcessor(cfg.recordOutput)
		isStreaming, err := requestProcessor.ProcessRequest(req, span, operation)
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
			span.RecordError(err)
			return nil, err
		}

		resp, err := next(req.WithContext(ctx))
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
			span.RecordError(err)
			if resp != nil {
				span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(resp.StatusCode))
			}
			return resp, err
		}

		if resp != nil {
			span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(resp.StatusCode))
			if resp.StatusCode >= 400 {
				span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
				return resp, nil
			} else {
				span.SetStatus(codes.Ok, "")
			}

			if resp.Body != nil && resp.Body != http.NoBody {
				if isStreaming {
					// For streaming responses, the span will be ended by the response processor
					// so we prevent the defer from ending it
					shouldEndSpan = false
					newBody, err := responseProcessor.ProcessStreamingResponse(resp.Body, span)
					if err != nil {
						// If there's an error setting up streaming, we need to end the span here
						shouldEndSpan = true
						span.SetStatus(codes.Error, err.Error())
						span.RecordError(err)
						return resp, err
					}
					resp.Body = newBody
				} else {
					if err := responseProcessor.ProcessNonStreamingResponse(resp, span); err != nil {
						logError("Error processing non-streaming response: %v", err)
					}
				}
			}
		}

		return resp, nil
	}
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
