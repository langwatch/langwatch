package langwatch

import (
	"encoding/json"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
)

// DataCaptureMode controls whether a span's input and/or output *content* is
// exported. It gates the content attributes (langwatch.input/output, the RAG
// contexts and their gen_ai.* message/prompt/completion equivalents) — span
// structure, metrics, metadata, models and identity are always kept.
//
// DataCaptureNone additionally strips the free content a span carries in its
// *events*: a tracked event's event.details.* annotations and an evaluation's
// free-text details. Their signal (event type, metrics, evaluation score and
// pass/fail) survives. Errors recorded with RecordError are diagnostics, not
// captured content, and are never stripped.
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
//
// RAG contexts count as input: langwatch.rag.contexts carries the text of the
// retrieved documents that were fed to the model, not just their identifiers.
var (
	dataCaptureInputKeys = map[attribute.Key]struct{}{
		AttributeLangWatchInput:            {},
		AttributeLangWatchInstructions:     {},
		AttributeLangWatchRAGContexts:      {},
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

// filteredSpan wraps a ReadOnlySpan, overriding Attributes() and Events() to
// return reduced sets. Embedding the interface promotes all its methods
// (including unexported ones), so filteredSpan still satisfies
// sdktrace.ReadOnlySpan.
type filteredSpan struct {
	sdktrace.ReadOnlySpan
	attrs  []attribute.KeyValue
	events []sdktrace.Event
}

func (f filteredSpan) Attributes() []attribute.KeyValue { return f.attrs }
func (f filteredSpan) Events() []sdktrace.Event         { return f.events }

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

	// Span events carry content of their own — a tracked event's free-text
	// annotations, an evaluation's free-text details — that no attribute filter
	// reaches. A span event is neither model input nor model output, so it is
	// only stripped by the mode that captures nothing at all.
	events := span.Events()
	if dropInput && dropOutput {
		events = stripEventContent(events)
	}

	return filteredSpan{ReadOnlySpan: span, attrs: kept, events: events}
}

// stripEventContent removes free content from span events while keeping the
// signal they carry: a tracked event keeps its type and numeric metrics but
// loses its event.details.* annotations, and an evaluation keeps its identity,
// status, score and pass/fail but loses its free-text details. An evaluation
// payload that cannot be decoded is dropped rather than forwarded whole.
func stripEventContent(events []sdktrace.Event) []sdktrace.Event {
	out := make([]sdktrace.Event, 0, len(events))
	for _, event := range events {
		kept := make([]attribute.KeyValue, 0, len(event.Attributes))
		for _, kv := range event.Attributes {
			switch {
			case strings.HasPrefix(string(kv.Key), EventDetailsPrefix):
				continue
			case kv.Key == AttributeEvaluationPayload:
				redacted, ok := redactEvaluationPayload(kv.Value.AsString())
				if !ok {
					continue
				}
				kept = append(kept, AttributeEvaluationPayload.String(redacted))
			default:
				kept = append(kept, kv)
			}
		}
		event.Attributes = kept
		out = append(out, event)
	}
	return out
}

// redactEvaluationPayload removes the free-text details field from an encoded
// evaluation, reporting whether the payload could be decoded at all.
func redactEvaluationPayload(payload string) (string, bool) {
	var eval map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payload), &eval); err != nil {
		return "", false
	}
	if _, ok := eval["details"]; !ok {
		return payload, true
	}

	delete(eval, "details")
	redacted, err := json.Marshal(eval)
	if err != nil {
		return "", false
	}
	return string(redacted), true
}
