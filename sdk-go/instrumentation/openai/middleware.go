package openai

import (
	"fmt"
	"net/http"
	"path"
	"strings"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	oaioption "github.com/openai/openai-go/option"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/log/global"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
	"go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

const (
	instrumentationName    = "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
	instrumentationVersion = "0.0.1"
)

// Middleware sets up a handler to start tracing the requests made to OpenAI by the
// OpenAI library.
func Middleware(name string, opts ...Option) oaioption.Middleware {
	cfg := config{
		genAISystem:         semconv.GenAISystemOpenai,
		contentRecordPolicy: events.NewProtectedContentRecordPolicy(),
		slogger:             defaultLogger, // zero-noise default
	}
	for _, opt := range opts {
		opt.apply(&cfg)
	}

	if cfg.tracerProvider == nil {
		cfg.tracerProvider = otel.GetTracerProvider()
	}
	if cfg.loggerProvider == nil {
		cfg.loggerProvider = global.GetLoggerProvider()
	}
	if cfg.propagators == nil {
		cfg.propagators = otel.GetTextMapPropagator()
	}

	tracerOpts := []trace.TracerOption{
		trace.WithInstrumentationVersion(instrumentationVersion),
		trace.WithSchemaURL(semconv.SchemaURL),
	}
	loggerOpts := []log.LoggerOption{
		log.WithInstrumentationVersion(instrumentationVersion),
		log.WithSchemaURL(semconv.SchemaURL),
	}

	cfg.tracer = *langwatch.TracerFromTracerProvider(cfg.tracerProvider, instrumentationName, tracerOpts...)
	cfg.logger = cfg.loggerProvider.Logger(instrumentationName, loggerOpts...)

	return func(req *http.Request, next oaioption.MiddlewareNext) (*http.Response, error) {
		operation := path.Base(req.URL.Path)
		genAISystemName := cfg.genAISystem.Value.AsString()
		spanName := genAISystemName + "." + operation

		genAIOperation := getGenAIOperationFromPath(req.URL.Path)

		ctx, span := cfg.tracer.Start(req.Context(), spanName,
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

		// Use the new refactored processor with domain-specific handling
		processor := apis.NewProcessor(genAISystemName, cfg.contentRecordPolicy, cfg.loggerProvider, cfg.slogger)
		isStreaming, err := processor.ProcessRequest(ctx, req, span)
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

			// Set span status based on HTTP status code
			if resp.StatusCode >= 400 {
				span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
			} else {
				span.SetStatus(codes.Ok, "")
			}

			// Process response body for both success and error cases to extract attributes
			if resp.Body != nil && resp.Body != http.NoBody {
				if isStreaming {
					// For streaming responses, the span will be ended by the response processor
					// so we prevent the defer from ending it
					shouldEndSpan = false
					newBody, err := processor.ProcessResponse(ctx, resp, span, isStreaming)
					if err != nil {
						// If there's an error setting up streaming, we need to end the span here
						shouldEndSpan = true
						span.SetStatus(codes.Error, err.Error())
						span.RecordError(err)
						return resp, err
					}
					resp.Body = newBody
				} else {
					if _, err := processor.ProcessResponse(ctx, resp, span, isStreaming); err != nil {
						logError("Error processing non-streaming response: %v", err)
					}
				}
			} else {
				fmt.Printf("DEBUG: No response body to process\n")
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
