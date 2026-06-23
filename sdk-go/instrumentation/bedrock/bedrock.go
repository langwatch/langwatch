// Package bedrock provides LangWatch OpenTelemetry instrumentation for the AWS
// Bedrock Runtime (github.com/aws/aws-sdk-go-v2/service/bedrockruntime).
//
// Unlike HTTP-bytes instrumentations, Bedrock is traced via the AWS smithy-go
// middleware stack: the middleware reads the *typed* operation input and output
// structs (e.g. *bedrockruntime.ConverseInput / *bedrockruntime.ConverseOutput)
// rather than parsing SigV4-signed HTTP bodies. This yields richer, more robust
// attribute extraction with no body buffering.
//
// # Setup
//
// Instrument an aws.Config so every Bedrock Runtime client built from it is
// traced:
//
//	cfg, _ := awsconfig.LoadDefaultConfig(ctx)
//	bedrock.InstrumentConfig(&cfg)
//	client := bedrockruntime.NewFromConfig(cfg)
//
// Or add the middleware to a single client / operation:
//
//	client := bedrockruntime.NewFromConfig(cfg, func(o *bedrockruntime.Options) {
//	    o.APIOptions = append(o.APIOptions, bedrock.WithTracing())
//	})
package bedrock

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/smithy-go/middleware"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdk-go/instrumentation/bedrock"
	instrumentationVersion = "0.0.1"
	// middlewareID is the smithy-go middleware identifier. It is added to the
	// Initialize step so it observes the typed input and output structs.
	middlewareID = "LangWatchBedrockTracing"
)

// defaultGenAIProvider is recorded as gen_ai.provider.name unless overridden via
// WithGenAIProvider. The OTel GenAI semconv value for AWS Bedrock is
// "aws.bedrock".
var defaultGenAIProvider = semconv.GenAIProviderNameAWSBedrock

// InstrumentConfig appends the LangWatch tracing middleware to cfg.APIOptions so
// that every Bedrock Runtime client subsequently constructed from cfg is traced.
// It is the simplest integration point — call it once after loading the config.
func InstrumentConfig(cfg *aws.Config, opts ...Option) {
	if cfg == nil {
		return
	}
	cfg.APIOptions = append(cfg.APIOptions, WithTracing(opts...))
}

// WithTracing returns a smithy-go stack mutator that adds the LangWatch tracing
// middleware. Pass it to a client's or operation's APIOptions when you want to
// instrument a single client rather than a whole aws.Config:
//
//	client := bedrockruntime.NewFromConfig(cfg, func(o *bedrockruntime.Options) {
//	    o.APIOptions = append(o.APIOptions, bedrock.WithTracing())
//	})
func WithTracing(opts ...Option) func(*middleware.Stack) error {
	cfg := newConfig(opts...)
	if cfg.tracerProvider == nil {
		cfg.tracerProvider = otel.GetTracerProvider()
	}
	tracer := langwatch.TracerFromProvider(cfg.tracerProvider, tracerName,
		trace.WithInstrumentationVersion(instrumentationVersion),
		trace.WithSchemaURL(semconv.SchemaURL),
	)
	mw := &tracingMiddleware{cfg: cfg, tracer: tracer}

	return func(stack *middleware.Stack) error {
		// Add to the Initialize step's front so the span wraps the whole
		// operation (serialization, signing, transport, deserialization) and the
		// middleware sees the typed input/output rather than the wire bytes.
		return stack.Initialize.Add(mw, middleware.Before)
	}
}

// tracingMiddleware is the smithy-go Initialize middleware that starts a span
// around the operation, records request attributes from the typed input, then
// records response attributes from the typed output and ends the span.
type tracingMiddleware struct {
	cfg    config
	tracer *langwatch.LangWatchTracer
}

// ID identifies the middleware within the smithy-go stack.
func (m *tracingMiddleware) ID() string { return middlewareID }

// HandleInitialize starts the span, dispatches by typed-input shape to record
// request attributes, invokes the rest of the stack, then dispatches by
// typed-output shape to record response attributes. For ConverseStream the span
// is handed to a stream wrapper that ends it once the event stream is drained.
func (m *tracingMiddleware) HandleInitialize(
	ctx context.Context,
	in middleware.InitializeInput,
	next middleware.InitializeHandler,
) (middleware.InitializeOutput, middleware.Metadata, error) {
	handler := selectHandler(in.Parameters)
	if handler == nil {
		// Not an operation we instrument — pass through untouched.
		return next.HandleInitialize(ctx, in)
	}

	provider := m.cfg.genAIProvider.Value.AsString()
	ctx, span := m.tracer.Start(ctx, provider+"."+handler.operation(),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			m.cfg.genAIProvider,
			semconv.GenAIOperationNameKey.String(handler.operation()),
			langwatch.AttributeLangWatchSpanType.String(string(langwatch.SpanTypeLLM)),
		),
	)
	// Mark the request start so a streaming handler can record TTFT (the latency
	// to the first streamed event) relative to it.
	start := time.Now()
	// Record gen_ai.request.stream (OTel GenAI semconv): true for ConverseStream /
	// InvokeModelWithResponseStream, false for the unary Converse / InvokeModel.
	span.SetGenAIRequestStream(handler.streaming())

	// Record request attributes from the typed input.
	handler.recordRequest(span, in.Parameters, m.cfg.dataCapture)

	// The span is ended here unless a streaming output takes ownership of it.
	bodyOwnsSpan := false
	defer func() {
		if !bodyOwnsSpan {
			span.End()
		}
	}()

	out, metadata, err := next.HandleInitialize(ctx, in)
	if err != nil {
		span.SetStatus(codes.Error, err.Error())
		span.RecordError(err)
		return out, metadata, err
	}

	// Record response attributes from the typed output. A streaming handler may
	// take ownership of the span (deferring End until the stream is drained); it
	// is given the operation context so it can finalise on cancellation, and the
	// request start so it can record TTFT on the first streamed event.
	bodyOwnsSpan = handler.recordResponse(ctx, span, out.Result, m.cfg.dataCapture, start)
	if !bodyOwnsSpan {
		span.SetStatus(codes.Ok, "")
	}
	return out, metadata, err
}

// operationHandler maps one Bedrock operation's typed input/output onto a span.
// Implementations are stateless; one instance per operation kind is reused.
type operationHandler interface {
	// operation is the gen_ai.operation.name value and the span-name suffix.
	operation() string
	// streaming reports whether the operation returns an event stream.
	streaming() bool
	// recordRequest records request attributes from the typed *XxxInput.
	recordRequest(span *langwatch.Span, params any, capture langwatch.DataCaptureMode)
	// recordResponse records response attributes from the typed *XxxOutput and
	// reports whether it took ownership of the span (true => caller must NOT end
	// the span; the handler ends it once a stream is drained). The operation
	// context lets a streaming handler finalise the span on cancellation; start is
	// the request start, used to record TTFT on the first streamed event.
	recordResponse(ctx context.Context, span *langwatch.Span, result any, capture langwatch.DataCaptureMode, start time.Time) bool
}

// setJSONAttribute marshals data to a JSON string attribute, skipping nil and
// logging (without failing) on marshalling errors.
func setJSONAttribute(span *langwatch.Span, key string, data any) {
	if data == nil {
		return
	}
	if str, ok := data.(string); ok {
		span.SetAttributes(attribute.String(key, str))
		return
	}
	jsonBytes, err := marshalJSON(data)
	if err != nil {
		logError("failed to marshal %s to JSON: %v", key, err)
		return
	}
	span.SetAttributes(attribute.String(key, string(jsonBytes)))
}
