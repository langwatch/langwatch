package langwatch

import (
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Event is a LangWatch tracked event attached to a trace — user feedback or a
// product signal (thumbs up/down, selected text, …). Record it live on a span
// with RecordEvent (it rides the normal span export, no extra HTTP call), or
// later by trace id via the client SDK's events API. The field shape matches the
// server's track-event model: a string Type, numeric Metrics, and string Details.
type Event struct {
	// Type is the event_type, e.g. "thumbs_up_down", "selected_text", or a custom
	// event name.
	Type string
	// Metrics are the numeric measurements for the event, e.g. {"vote": 1}.
	Metrics map[string]float64
	// Details are optional string annotations, e.g. {"feedback": "loved it"}.
	Details map[string]string
}

// RecordEvent attaches a LangWatch tracked event to the span as a langwatch.event
// span event, carrying event.type / event.metrics.* / event.details.* — the same
// shape the server records for tracked events.
func (s *Span) RecordEvent(event Event) *Span {
	attrs := make([]attribute.KeyValue, 0, 1+len(event.Metrics)+len(event.Details))
	attrs = append(attrs, attribute.String("event.type", event.Type))
	for k, v := range event.Metrics {
		attrs = append(attrs, attribute.Float64("event.metrics."+k, v))
	}
	for k, v := range event.Details {
		attrs = append(attrs, attribute.String("event.details."+k, v))
	}
	s.AddEvent("langwatch.event", trace.WithAttributes(attrs...))
	return s
}

// RecordThumbsUp records positive user feedback on the trace (the thumbs_up_down
// event with vote=+1), with an optional free-text comment.
//
//	span.RecordThumbsUp("nailed the answer")
func (s *Span) RecordThumbsUp(feedback ...string) *Span {
	return s.recordVote(1, feedback...)
}

// RecordThumbsDown records negative user feedback on the trace (the
// thumbs_up_down event with vote=-1), with an optional free-text comment.
func (s *Span) RecordThumbsDown(feedback ...string) *Span {
	return s.recordVote(-1, feedback...)
}

func (s *Span) recordVote(vote float64, feedback ...string) *Span {
	event := Event{Type: "thumbs_up_down", Metrics: map[string]float64{"vote": vote}}
	if len(feedback) > 0 && feedback[0] != "" {
		event.Details = map[string]string{"feedback": feedback[0]}
	}
	return s.RecordEvent(event)
}
