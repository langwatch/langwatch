// Package http holds the evaluators module's channels that reach a remote
// service over HTTP. Importers alias it evalhttp. Plan: §3.1.
package http

import (
	"context"
	"errors"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// customerTraceMetricPrefix names this channel's customer-trace counters.
const customerTraceMetricPrefix = "langwatch.nlpgo.evaluators"

// CustomerTraceOptions configures NewCustomerTrace.
type CustomerTraceOptions struct {
	// Endpoint is the LangWatch OTLP base URL. Empty exports nothing.
	Endpoint string
	Logger   *zap.Logger
	// MeterProvider reads the drop and export counters; nil uses the global one.
	MeterProvider metric.MeterProvider
}

// CustomerTrace exports an evaluation's spans, content included, into the
// project its token belongs to (plan §6.1), over pkg/customertracebridge.
type CustomerTrace struct {
	endpoint string
	registry *customertracebridge.Registry
	emitter  *customertracebridge.Emitter
	logger   *zap.Logger
}

var _ channels.CustomerTraceChannel = (*CustomerTrace)(nil)

// NewCustomerTrace builds the channel. ctx must carry the service info.
func NewCustomerTrace(ctx context.Context, opts CustomerTraceOptions) (*CustomerTrace, error) {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	c := &CustomerTrace{endpoint: opts.Endpoint, logger: logger}
	if opts.Endpoint == "" {
		return c, nil
	}
	if err := customertracebridge.ValidateEndpoint(opts.Endpoint); err != nil {
		return nil, fmt.Errorf("customer trace endpoint: %w", err)
	}
	c.registry = customertracebridge.NewRegistry()
	emitter, err := customertracebridge.NewEmitter(ctx, customertracebridge.EmitterOptions{
		Registry: c.registry,
		Policy: customertracebridge.Policy{Stamp: []attribute.KeyValue{
			attribute.String(otelsetup.AttrLangWatchOrigin, customertracebridge.OriginEvaluation),
		}},
		MetricPrefix:  customerTraceMetricPrefix,
		MeterProvider: opts.MeterProvider,
	})
	if err != nil {
		return nil, fmt.Errorf("customer trace emitter: %w", err)
	}
	c.emitter = emitter
	return c, nil
}

// StartEvaluation opens the evaluation span under the inbound traceparent.
// No traceparent traces nothing; no token traces nothing and counts the drop.
func (c *CustomerTrace) StartEvaluation(
	ctx context.Context, ev channels.EvaluationSpan,
) (context.Context, func(channels.EvaluationOutcome)) {
	if c.emitter == nil || ev.Trace.Traceparent == "" {
		return ctx, func(channels.EvaluationOutcome) {}
	}
	route, err := c.registry.SetRoute(ev.Tenant.ProjectID, ev.Trace.Token, c.endpoint)
	if err != nil {
		c.logger.Warn("customer_trace_route_rejected", zap.Error(err))
	}
	ctx, span := c.emitter.StartSpan(ctx, customertracebridge.SpanStart{
		Route:       route,
		Traceparent: ev.Trace.Traceparent,
		Name:        "evaluation." + ev.Evaluator,
		Attributes:  []attribute.KeyValue{attribute.String("langwatch.span.type", "evaluation")},
	})
	return ctx, func(out channels.EvaluationOutcome) {
		for _, r := range out.Results {
			if r.Status == contract.StatusError {
				span.SetStatus(codes.Error, r.ErrorType)
				break
			}
		}
		span.End()
	}
}

// StartCall opens one model-call span under the evaluation span in ctx.
func (c *CustomerTrace) StartCall(ctx context.Context, call channels.CallSpan) func(channels.CallOutcome) {
	if c.emitter == nil {
		return func(channels.CallOutcome) {}
	}
	_, span := c.emitter.StartSpan(ctx, customertracebridge.SpanStart{
		Name:       "gen_ai." + call.Kind,
		Kind:       trace.SpanKindClient,
		Attributes: []attribute.KeyValue{semconv.GenAIOperationNameKey.String(call.Kind)},
	})
	return func(out channels.CallOutcome) {
		c.emitter.EndCallSpan(span, customertracebridge.CallResult{
			Kind:         call.Kind,
			Model:        call.Model,
			RequestBody:  out.RequestBody,
			ResponseBody: out.ResponseBody,
			InputTokens:  out.Usage.PromptTokens,
			OutputTokens: out.Usage.CompletionTokens,
			CostUSD:      out.CostUSD,
			ErrorType:    callErrorType(out.Err),
		})
	}
}

// Shutdown flushes pending spans.
func (c *CustomerTrace) Shutdown(ctx context.Context) error {
	if c.emitter == nil {
		return nil
	}
	return c.emitter.Shutdown(ctx)
}

// callErrorType is a stable class for the span, never the error's text.
func callErrorType(err error) string {
	if err == nil {
		return ""
	}
	var e herr.E
	if errors.As(err, &e) && e.Code != "" {
		return string(e.Code)
	}
	return "provider_error"
}
