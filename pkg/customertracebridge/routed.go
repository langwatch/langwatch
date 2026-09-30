package customertracebridge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/aitrace"
)

// Routed spans are the path for a project/token pair that arrives on a
// request rather than from the control plane (plan §6.1 of
// dev/docs/plans/langevals-go-replacement.md). BeginSpan/EndSpan and routing
// by bare project id are unchanged; nothing here runs unless StartSpan is called.
const (
	// attrRouteKey is routing only: the router reads it and strips it.
	attrRouteKey = attribute.Key("langwatch.route_key")
	// attrCausalityDepth >= 1 tells the evaluation trigger this trace is
	// derived work, so it never triggers another evaluation.
	attrCausalityDepth = attribute.Key("langwatch.reserved.causality_depth")
)

// OriginEvaluation is the langwatch.origin of an evaluation's own spans. An
// emitter whose Policy stamps it never drops a call span as a probe.
const OriginEvaluation = "evaluation"

// dropReasonNoToken counts spans withheld because the request had no token.
const dropReasonNoToken = "no_token"

// RouteKey is the registry key for a project/token pair. Ingest decides the
// project from the token, so a pair naming another project can only ever
// export into the token's own project, under a key of its own.
func RouteKey(projectID, token string) string {
	sum := sha256.Sum256([]byte(token))
	return projectID + ":" + hex.EncodeToString(sum[:])[:12]
}

// SetRoute registers endpoint for a project/token pair and returns its route
// key. A missing project, token or endpoint registers and removes nothing and
// returns "", so a keyless request never touches another request's entry.
func (r *Registry) SetRoute(projectID, token, endpoint string) (string, error) {
	if projectID == "" || token == "" || endpoint == "" {
		return "", nil
	}
	key := RouteKey(projectID, token)
	if err := r.Set(key, endpoint, map[string]string{"X-Auth-Token": token}); err != nil {
		return "", err
	}
	return key, nil
}

// ValidateEndpoint reports ErrInvalidEndpoint for a non-http(s) endpoint.
func ValidateEndpoint(endpoint string) error {
	return validateEndpointScheme(endpoint)
}

// SpanStart names a routed span. Route comes from Registry.SetRoute; empty
// inherits the routed parent's. Traceparent is the inbound parent, used only
// when the context carries no routed parent.
type SpanStart struct {
	Route       string
	Traceparent string
	Name        string
	Kind        trace.SpanKind
	Attributes  []attribute.KeyValue
}

type routedSpanKey struct{}

type routedSpan struct {
	span  trace.Span
	route string
}

// StartSpan opens a routed span under the routed parent in ctx, else under
// Traceparent. It never roots a trace: with no valid parent it returns a no-op
// span. With a parent but no route it returns a no-op span, counts the drop,
// and its children are counted too. The parent chain rides a bridge-private
// context key, never the ambient OTel span, so internal tracing never adopts it.
func (e *Emitter) StartSpan(ctx context.Context, start SpanStart) (context.Context, trace.Span) {
	parentCtx, route := context.Background(), start.Route
	if parent, ok := ctx.Value(routedSpanKey{}).(routedSpan); ok {
		parentCtx = trace.ContextWithSpan(parentCtx, parent.span)
		if route == "" {
			route = parent.route
		}
	} else if start.Traceparent != "" {
		parentCtx = e.customerSpanContext(start.Traceparent)
	}
	if !trace.SpanContextFromContext(parentCtx).IsValid() {
		return ctx, trace.SpanFromContext(context.Background())
	}
	if route == "" {
		e.router.dropped(ctx, dropReasonNoToken, 1)
		placeholder := trace.SpanFromContext(parentCtx) // non-recording
		return context.WithValue(ctx, routedSpanKey{}, routedSpan{span: placeholder}), placeholder
	}

	attrs := make([]attribute.KeyValue, 0, len(start.Attributes)+2)
	attrs = append(attrs, start.Attributes...)
	attrs = append(attrs, attrRouteKey.String(route), attrCausalityDepth.Int(1))
	//nolint:spancheck // the caller ends the returned span.
	_, span := e.tracer.Start(parentCtx, start.Name,
		trace.WithSpanKind(start.Kind), trace.WithAttributes(attrs...))
	//nolint:spancheck // the caller ends the returned span.
	return context.WithValue(ctx, routedSpanKey{}, routedSpan{span: span, route: route}), span
}

// CallResult is one model call's outcome, stamped as EndSpan stamps a
// gateway call: messages extracted from the bodies, never the raw bodies.
type CallResult struct {
	Kind         string // "chat" or "embeddings"
	Model        string
	RequestBody  []byte
	ResponseBody []byte
	InputTokens  int
	OutputTokens int
	CostUSD      *float64
	ErrorType    string // a stable error class; empty on success
}

// EndCallSpan stamps call on a span StartSpan opened and ends it.
func (e *Emitter) EndCallSpan(span trace.Span, call CallResult) {
	if !span.IsRecording() {
		return
	}
	var costMicroUSD int64
	if call.CostUSD != nil {
		costMicroUSD = int64(math.Round(*call.CostUSD * 1e6))
	}
	// A clean context: gateway request values must never reach this span.
	e.endGenAISpan(context.Background(), span, aitrace.Params{
		Model:        call.Model,
		RequestType:  aitrace.RequestType(call.Kind),
		RequestBody:  call.RequestBody,
		ResponseBody: call.ResponseBody,
		Usage: aitrace.Usage{
			PromptTokens:     call.InputTokens,
			CompletionTokens: call.OutputTokens,
			TotalTokens:      call.InputTokens + call.OutputTokens,
			CostMicroUSD:     costMicroUSD,
		},
		UpstreamErrorType: call.ErrorType,
	})
}

// withoutAttr returns s with key removed. The batch's spans are not ours to
// mutate, so it rebuilds a snapshot.
func withoutAttr(s sdktrace.ReadOnlySpan, key attribute.Key) sdktrace.ReadOnlySpan {
	stub := tracetest.SpanStubFromReadOnlySpan(s)
	kept := make([]attribute.KeyValue, 0, len(stub.Attributes))
	for _, a := range stub.Attributes {
		if a.Key != key {
			kept = append(kept, a)
		}
	}
	stub.Attributes = kept
	return stub.Snapshot()
}
