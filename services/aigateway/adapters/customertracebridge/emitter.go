package customertracebridge

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/tidwall/gjson"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	attrProjectID      = attribute.Key("langwatch.project_id")
	attrTotalUsage     = attribute.Key("gen_ai.usage.total_tokens")
	attrCost           = attribute.Key("gen_ai.usage.cost")
	attrInputMessages  = attribute.Key("gen_ai.input.messages")
	attrOutputMessages = attribute.Key("gen_ai.output.messages")
)

// Emitter uses a private (non-global) OTel TracerProvider to construct spans
// and export them to the customer's OTLP endpoint. The TP has an empty Resource
// so customers only see the instrumentation scope, not the gateway's service identity.
type Emitter struct {
	tp         *sdktrace.TracerProvider
	tracer     trace.Tracer
	propagator propagation.TextMapPropagator
}

// EmitterOptions configures the Emitter.
type EmitterOptions struct {
	Registry     *Registry
	BatchTimeout time.Duration
	MaxQueueSize int
}

// NewEmitter creates a customer trace bridge backed by a private TracerProvider.
func NewEmitter(ctx context.Context, opts EmitterOptions) (*Emitter, error) {
	if opts.Registry == nil {
		opts.Registry = NewRegistry()
	}

	router := newRouterExporter(opts.Registry)

	batchTimeout := opts.BatchTimeout
	if batchTimeout == 0 {
		batchTimeout = 5 * time.Second
	}
	queueSize := opts.MaxQueueSize
	if queueSize == 0 {
		queueSize = 8192
	}

	// Empty resource — customers see instrumentation scope only.
	// AlwaysSample: the gateway never drops customer spans regardless of
	// the gateway's own sample ratio setting.
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(resource.Empty()),
		sdktrace.WithBatcher(router,
			sdktrace.WithBatchTimeout(batchTimeout),
			sdktrace.WithMaxQueueSize(queueSize),
		),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)

	svcCtx := contexts.MustGetServiceInfo(ctx)

	return &Emitter{
		tp:         tp,
		tracer:     tp.Tracer(fmt.Sprintf("langwatch-%s", svcCtx.Service), trace.WithInstrumentationVersion(svcCtx.Version)),
		propagator: propagation.TraceContext{},
	}, nil
}

// BeginSpan starts a customer-facing span that nests under the customer's
// inbound traceparent. It returns an enriched context (carrying the open span)
// and a W3C traceparent string representing the new span.
func (e *Emitter) BeginSpan(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string) {
	tp := TraceParent(ctx)
	spanCtx := e.customerSpanContext(tp)

	spanCtx, span := e.tracer.Start(spanCtx, "gen_ai."+string(reqType),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attrProjectID.String(projectID),
			semconv.GenAIOperationNameKey.String(string(reqType)),
		),
	)

	// Store the span in request context so EndSpan can retrieve it.
	ctx = withActiveSpan(ctx, span)

	// Format the span's context as a W3C traceparent for the response header.
	sc := span.SpanContext()
	traceparent := formatTraceparent(sc)

	_ = spanCtx // span lifecycle managed via activeSpan context key
	return ctx, traceparent
}

// EndSpan retrieves the span started by BeginSpan, sets final attributes, and
// ends it. If no span is found in context this is a no-op.
func (e *Emitter) EndSpan(ctx context.Context, params domain.AITraceParams) {
	span := activeSpanFrom(ctx)
	if span == nil {
		return
	}

	attrs := []attribute.KeyValue{
		semconv.GenAIProviderNameKey.String(string(params.ProviderID)),
		semconv.GenAIRequestModelKey.String(params.Model),
		semconv.GenAIUsageInputTokensKey.Int(params.Usage.PromptTokens),
		semconv.GenAIUsageOutputTokensKey.Int(params.Usage.CompletionTokens),
		attrTotalUsage.Int(params.Usage.TotalTokens),
		attrCost.Int64(params.Usage.CostMicroUSD),
	}
	// VK id + request id let the control plane's trace-processing pipeline
	// identify gateway traces and fold idempotent budget debits into ClickHouse.
	// See specs/ai-gateway/_shared/contract.md §4.5.
	if params.VirtualKeyID != "" {
		attrs = append(attrs, attribute.String(gatewaytracer.AttrVirtualKeyID, params.VirtualKeyID))
	}
	if params.GatewayRequestID != "" {
		attrs = append(attrs, attribute.String(gatewaytracer.AttrGatewayReqID, params.GatewayRequestID))
	}
	span.SetAttributes(attrs...)

	if input := extractInputMessages(params.RequestBody, params.RequestType); input != "" {
		span.SetAttributes(attrInputMessages.String(input))
	}
	if output := extractOutputMessages(params.ResponseBody, params.RequestType); output != "" {
		span.SetAttributes(attrOutputMessages.String(output))
	}

	span.End()
}

// Shutdown flushes pending spans to customer endpoints.
func (e *Emitter) Shutdown(ctx context.Context) error {
	if e.tp != nil {
		return e.tp.Shutdown(ctx)
	}
	return nil
}

// customerSpanContext builds a context with the customer's trace/span IDs as
// the parent, using a fresh context.Background() — never the request context.
func (e *Emitter) customerSpanContext(traceparent string) context.Context {
	if traceparent == "" {
		// No customer traceparent — span will be a new root trace.
		return context.Background()
	}

	// Use the W3C propagator to extract into a clean context.
	carrier := propagation.MapCarrier{"traceparent": traceparent}
	return e.propagator.Extract(context.Background(), carrier)
}

// formatTraceparent formats a SpanContext as a W3C traceparent header value.
func formatTraceparent(sc trace.SpanContext) string {
	if !sc.IsValid() {
		return ""
	}
	flags := "00"
	if sc.IsSampled() {
		flags = "01"
	}
	return fmt.Sprintf("00-%s-%s-%s", sc.TraceID().String(), sc.SpanID().String(), flags)
}

// parseTraceparent extracts trace ID and parent span ID from a W3C traceparent
// header: "00-<traceID>-<spanID>-<flags>"
func parseTraceparent(tp string) (traceID []byte, spanID []byte) {
	if tp == "" {
		return nil, nil
	}
	parts := strings.Split(tp, "-")
	if len(parts) < 4 {
		return nil, nil
	}
	tid, err := hex.DecodeString(parts[1])
	if err != nil || len(tid) != 16 {
		return nil, nil
	}
	sid, err := hex.DecodeString(parts[2])
	if err != nil || len(sid) != 8 {
		return nil, nil
	}
	return tid, sid
}

// extractInputMessages returns the JSON-encoded messages array from the request body.
func extractInputMessages(body []byte, _ domain.RequestType) string {
	if len(body) == 0 {
		return ""
	}
	r := gjson.GetBytes(body, "messages")
	if !r.Exists() {
		return ""
	}
	return r.Raw
}

// extractOutputMessages returns the JSON-encoded assistant message(s) from the response body.
func extractOutputMessages(body []byte, reqType domain.RequestType) string {
	if len(body) == 0 {
		return ""
	}
	switch reqType {
	case domain.RequestTypeChat:
		// OpenAI: choices[].message
		choices := gjson.GetBytes(body, "choices")
		if !choices.Exists() {
			return ""
		}
		var msgs []string
		choices.ForEach(func(_, v gjson.Result) bool {
			msg := v.Get("message")
			if msg.Exists() {
				msgs = append(msgs, msg.Raw)
			}
			return true
		})
		if len(msgs) == 0 {
			return ""
		}
		return "[" + strings.Join(msgs, ",") + "]"
	case domain.RequestTypeMessages:
		// Anthropic: content array is the output, wrap as assistant message
		content := gjson.GetBytes(body, "content")
		if !content.Exists() {
			return ""
		}
		return `[{"role":"assistant","content":` + content.Raw + `}]`
	default:
		return ""
	}
}
