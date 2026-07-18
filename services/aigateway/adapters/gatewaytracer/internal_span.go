package gatewaytracer

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ForbiddenInternalSpanAttrs are keys that must NEVER appear on the gateway's
// own operational span. They carry prompt and completion bodies, which belong
// to the customer's project and reach it through the customer trace bridge.
//
// Exported so the boundary is testable rather than a matter of care: see
// internal_span_test.go, which stamps a span from params holding real bodies
// and asserts neither these keys nor the body text survive.
var ForbiddenInternalSpanAttrs = []string{
	"gen_ai.input.messages",
	"gen_ai.output.messages",
	"gen_ai.system_instructions",
	"gen_ai.prompt",
	"gen_ai.completion",
}

// aiTraceEmitter is the customer-trace port this package decorates. Declared
// here rather than imported so the adapter does not depend on app/.
type aiTraceEmitter interface {
	BeginSpan(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string)
	EndSpan(ctx context.Context, params domain.AITraceParams)
}

// StampingEmitter decorates the customer trace emitter so that ending a
// customer span ALSO stamps the gateway's own operational span with the safe
// gen_ai metadata.
//
// The two destinations stay separate: the customer's project receives the
// content-bearing span built by the bridge, LangWatch's own backend receives
// shape and cost on the gateway span. This decorator is the only thing that
// connects them, and it copies scalars in one direction only.
type StampingEmitter struct{ Inner aiTraceEmitter }

// WithInternalStamping wraps an emitter so the gateway's own span is enriched
// alongside the customer's.
func WithInternalStamping(inner aiTraceEmitter) StampingEmitter {
	return StampingEmitter{Inner: inner}
}

func (s StampingEmitter) BeginSpan(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string) {
	return s.Inner.BeginSpan(ctx, projectID, reqType)
}

func (s StampingEmitter) EndSpan(ctx context.Context, params domain.AITraceParams) {
	StampInternalGenAI(ctx, params)
	s.Inner.EndSpan(ctx, params)
}

// StampInternalGenAI enriches the gateway's OWN span — the one started by
// Middleware, on the globally-registered provider — with the gen_ai metadata an
// operator needs: which model, which provider, how many tokens, what it cost,
// how it ended.
//
// params carries RequestBody and ResponseBody. They are deliberately not read.
// Everything stamped here is a scalar the gateway computed about the call, never
// a byte of what the customer sent or the model returned. This is the only place
// gen_ai metadata reaches internal telemetry, which is what makes the boundary
// pinnable by a single test.
//
// Safe to call with any context: a context with no recording span is a no-op.
func StampInternalGenAI(ctx context.Context, params domain.AITraceParams) {
	span := trace.SpanFromContext(ctx)
	if !span.IsRecording() {
		return
	}

	attrs := make([]attribute.KeyValue, 0, 12)
	if params.RequestType != "" {
		attrs = append(attrs, attribute.String(AttrGenAIOperationName, string(params.RequestType)))
	}
	if params.ProviderID != "" {
		attrs = append(attrs, attribute.String(AttrGenAISystem, string(params.ProviderID)))
	}
	if params.Model != "" {
		attrs = append(attrs, attribute.String(AttrGenAIRequestModel, params.Model))
	}
	if params.Usage.Model != "" {
		attrs = append(attrs, attribute.String(AttrGenAIResponseModel, params.Usage.Model))
	}
	if params.Usage.PromptTokens > 0 {
		attrs = append(attrs, attribute.Int(AttrGenAIUsageIn, params.Usage.PromptTokens))
	}
	if params.Usage.CompletionTokens > 0 {
		attrs = append(attrs, attribute.Int(AttrGenAIUsageOut, params.Usage.CompletionTokens))
	}
	if params.Usage.TotalTokens > 0 {
		attrs = append(attrs, attribute.Int(AttrGenAIUsageTotal, params.Usage.TotalTokens))
	}
	if params.Usage.CacheReadTokens > 0 {
		attrs = append(attrs, attribute.Int(AttrGenAIUsageCacheRead, params.Usage.CacheReadTokens))
	}
	if params.Usage.CacheCreationTokens > 0 {
		attrs = append(attrs, attribute.Int(AttrGenAIUsageCacheCreate, params.Usage.CacheCreationTokens))
	}
	if params.Usage.CostMicroUSD > 0 {
		attrs = append(attrs, attribute.Float64(AttrCostUSD, float64(params.Usage.CostMicroUSD)/1_000_000))
	}
	if params.VirtualKeyID != "" {
		attrs = append(attrs, attribute.String(AttrVirtualKeyID, params.VirtualKeyID))
	}
	if params.GatewayRequestID != "" {
		attrs = append(attrs, attribute.String(AttrGatewayReqID, params.GatewayRequestID))
	}
	if params.UpstreamErrorType != "" {
		attrs = append(attrs, attribute.String(AttrErrorType, params.UpstreamErrorType))
	}
	if params.UpstreamStatusCode != 0 {
		attrs = append(attrs, attribute.Int(AttrUpstreamStatusCode, params.UpstreamStatusCode))
	}

	span.SetAttributes(attrs...)
}
