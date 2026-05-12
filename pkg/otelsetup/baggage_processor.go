package otelsetup

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/baggage"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// BaggageAttributeProcessor copies a configurable set of baggage entries
// onto every span at start time. The baggage flows through context via the
// W3C baggage propagator (already registered in otelsetup.New()), so any
// span — root, child, grandchild, or one started from a goroutine that
// inherited the context — gets the attributes stamped automatically.
//
// Designed for cross-service signals that must appear on every emitted
// span without manually decorating each tracer.Start call site. Currently
// used for langwatch.causality_depth (online-evaluator loop prevention,
// see specs/monitors/online-evaluator-loop-prevention.feature) but the
// mechanism is general.
//
// Only the keys listed in `keys` are copied. Values are stored as string
// attributes (baggage is string-typed on the wire).
type BaggageAttributeProcessor struct {
	keys map[string]struct{}
}

// NewBaggageAttributeProcessor returns a SpanProcessor that stamps every
// span at OnStart with the given baggage keys (if present on the parent
// context). Keys not present in baggage are silently skipped.
func NewBaggageAttributeProcessor(keys ...string) *BaggageAttributeProcessor {
	set := make(map[string]struct{}, len(keys))
	for _, k := range keys {
		set[k] = struct{}{}
	}
	return &BaggageAttributeProcessor{keys: set}
}

func (p *BaggageAttributeProcessor) OnStart(parent context.Context, span sdktrace.ReadWriteSpan) {
	if len(p.keys) == 0 {
		return
	}
	bag := baggage.FromContext(parent)
	for _, m := range bag.Members() {
		if _, ok := p.keys[m.Key()]; !ok {
			continue
		}
		span.SetAttributes(attribute.String(m.Key(), m.Value()))
	}
}

func (p *BaggageAttributeProcessor) OnEnd(_ sdktrace.ReadOnlySpan)      {}
func (p *BaggageAttributeProcessor) Shutdown(_ context.Context) error   { return nil }
func (p *BaggageAttributeProcessor) ForceFlush(_ context.Context) error { return nil }
