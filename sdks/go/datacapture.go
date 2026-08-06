package langwatch

import (
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// DataCaptureMode controls whether a span's input and/or output *content* is
// exported. It gates the content attributes (langwatch.input/output and their
// gen_ai.* message/prompt/completion equivalents) — span structure, metrics,
// metadata, models and identity are always kept.
//
// Capture is enforced at export time by a LangWatch exporter configured with
// WithDataCapture / WithDataCaptureFunc, so it applies uniformly across every
// instrumentation (the OpenAI middleware, manual spans, …) regardless of what
// they recorded. The default, when unconfigured, is to capture everything.
type DataCaptureMode string

const (
	// DataCaptureAll captures both input and output (the default).
	DataCaptureAll DataCaptureMode = "all"
	// DataCaptureInput captures input only; output content is stripped.
	DataCaptureInput DataCaptureMode = "input"
	// DataCaptureOutput captures output only; input content is stripped.
	DataCaptureOutput DataCaptureMode = "output"
	// DataCaptureNone strips both input and output content.
	DataCaptureNone DataCaptureMode = "none"
)

// CaptureInput reports whether the mode captures input content.
func (m DataCaptureMode) CaptureInput() bool {
	return m == DataCaptureAll || m == DataCaptureInput
}

// CaptureOutput reports whether the mode captures output content.
func (m DataCaptureMode) CaptureOutput() bool {
	return m == DataCaptureAll || m == DataCaptureOutput
}

// DataCaptureContext is handed to a DataCapturePredicate for per-span decisions.
type DataCaptureContext struct {
	SpanName string
	SpanKind trace.SpanKind
	// SpanType is the langwatch.span.type value, if the span set one.
	SpanType   string
	Attributes []attribute.KeyValue
}

// DataCapturePredicate decides the capture mode for a single span. Returning a
// mode based on the span's type/name/attributes enables policies like "capture
// nothing for tool spans" or "inputs only in production".
type DataCapturePredicate func(DataCaptureContext) DataCaptureMode

// Content attribute keys stripped when input/output capture is disabled. These
// cover what LangWatch SDKs and the common GenAI conventions emit for content.
// The gen_ai.* keys reference the SAME semconv keys the setters emit
// (SetGenAIInputMessages, SetGenAISystemInstructions, …) so the strip-list
// cannot drift from what is recorded.
var (
	dataCaptureInputKeys = map[attribute.Key]struct{}{
		AttributeLangWatchInput:            {},
		AttributeLangWatchInstructions:     {},
		semconv.GenAIInputMessagesKey:      {},
		attribute.Key("gen_ai.prompt"):     {},
		semconv.GenAISystemInstructionsKey: {},
	}
	dataCaptureOutputKeys = map[attribute.Key]struct{}{
		AttributeLangWatchOutput:           {},
		semconv.GenAIOutputMessagesKey:     {},
		attribute.Key("gen_ai.completion"): {},
	}
)

// dataCaptureConfig holds the resolved capture policy for an exporter.
type dataCaptureConfig struct {
	enabled   bool
	mode      DataCaptureMode
	predicate DataCapturePredicate
}

// resolve returns the capture mode for a span (running the predicate if set).
func (c dataCaptureConfig) resolve(span sdktrace.ReadOnlySpan) DataCaptureMode {
	if c.predicate != nil {
		return c.predicate(DataCaptureContext{
			SpanName:   span.Name(),
			SpanKind:   span.SpanKind(),
			SpanType:   spanTypeAttr(span),
			Attributes: span.Attributes(),
		})
	}
	return c.mode
}

// spanTypeAttr reads the langwatch.span.type attribute off a span, if present.
func spanTypeAttr(span sdktrace.ReadOnlySpan) string {
	for _, kv := range span.Attributes() {
		if kv.Key == AttributeLangWatchSpanType {
			return kv.Value.AsString()
		}
	}
	return ""
}

// filteredSpan wraps a ReadOnlySpan, overriding Attributes() to return a reduced
// set. Embedding the interface promotes all its methods (including unexported
// ones), so filteredSpan still satisfies sdktrace.ReadOnlySpan.
type filteredSpan struct {
	sdktrace.ReadOnlySpan
	attrs []attribute.KeyValue
}

func (f filteredSpan) Attributes() []attribute.KeyValue { return f.attrs }

// applyDataCapture returns the span with input/output content attributes removed
// per mode. If nothing is stripped, the original span is returned unchanged.
func applyDataCapture(span sdktrace.ReadOnlySpan, mode DataCaptureMode) sdktrace.ReadOnlySpan {
	dropInput := !mode.CaptureInput()
	dropOutput := !mode.CaptureOutput()
	if !dropInput && !dropOutput {
		return span
	}

	attrs := span.Attributes()
	kept := make([]attribute.KeyValue, 0, len(attrs))
	for _, kv := range attrs {
		if dropInput {
			if _, drop := dataCaptureInputKeys[kv.Key]; drop {
				continue
			}
		}
		if dropOutput {
			if _, drop := dataCaptureOutputKeys[kv.Key]; drop {
				continue
			}
		}
		kept = append(kept, kv)
	}
	return filteredSpan{ReadOnlySpan: span, attrs: kept}
}
