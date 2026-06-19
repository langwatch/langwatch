package client

import (
	"context"
	"fmt"
	"net/http"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// EventsService records LangWatch tracked events against an already-ingested
// trace, addressed by trace id.
//
// Access it via [Client.Events]. It is the by-trace-id counterpart to the core
// SDK's live span.RecordEvent: the very same [langwatch.Event] value a developer
// records on a span while tracing can be handed to [EventsService.Track]
// afterwards. Capture the id from the span — span.SpanContext().TraceID().String()
// — and report user feedback or a product signal (thumbs up/down, selected text,
// …) later, once the user reacts.
type EventsService struct {
	client *Client
}

// Event is re-exported from the core module so callers depend only on this
// package while still passing the exact type span.RecordEvent accepts. The field
// shape matches the server's track-event model: a string Type, numeric Metrics
// and string Details.
type Event = langwatch.Event

// trackEventPath is the canonical LangWatch track-event REST endpoint. It
// replaces the legacy POST /api/track_event. Submissions go through
// [Client.rawJSON] so they share the SDK's auth, headers and retry behaviour.
const trackEventPath = "/api/events/track"

// trackEventRequest is the POST /api/events/track body. It mirrors the server's
// trackEventRESTParamsValidatorSchema: a trace_id, an event_type, a required
// numeric metrics map, and optional string event_details. The predefined
// thumbs_up_down event reads metrics.vote (-1..1) and event_details.feedback.
type trackEventRequest struct {
	TraceID      string             `json:"trace_id"`
	EventType    string             `json:"event_type"`
	Metrics      map[string]float64 `json:"metrics"`
	EventDetails map[string]string  `json:"event_details,omitempty"`
}

// Track records a tracked event against an existing trace, by trace id. The
// event is the same [langwatch.Event] (aliased here as [Event]) accepted by
// span.RecordEvent, so a value can be recorded live or submitted later through
// this method interchangeably.
//
//	traceID := span.SpanContext().TraceID().String()
//	// ... later, when the user reacts ...
//	err := lw.Events.Track(ctx, traceID, langwatch.Event{
//		Type:    "thumbs_up_down",
//		Metrics: map[string]float64{"vote": 1},
//		Details: map[string]string{"feedback": "loved it"},
//	})
//
// It maps to the LangWatch track-event endpoint (POST /api/events/track). Both
// the trace id and the event type are required; an empty value for either
// returns an error without sending a request.
func (s *EventsService) Track(ctx context.Context, traceID string, event Event) error {
	if traceID == "" {
		return fmt.Errorf("langwatch: Events.Track: traceID is required")
	}
	if event.Type == "" {
		return fmt.Errorf("langwatch: Events.Track: event Type is required")
	}

	body := trackEventRequest{
		TraceID:      traceID,
		EventType:    event.Type,
		Metrics:      event.Metrics,
		EventDetails: event.Details,
	}

	resp, err := s.client.rawJSON(ctx, http.MethodPost, trackEventPath, body)
	return decodeInto("Events.Track", resp, err, nil)
}

// ThumbsUp records positive user feedback on a trace as the predefined
// thumbs_up_down event with vote=+1, plus an optional free-text feedback string.
// It is the "the user clicked thumbs-up later, by trace id" flow: capture the id
// from a span while tracing — span.SpanContext().TraceID().String() — and call
// this afterwards.
//
//	traceID := span.SpanContext().TraceID().String()
//	// ... later, when the user reacts ...
//	err := lw.Events.ThumbsUp(ctx, traceID, "spot on")
//
// It is a thin convenience over [EventsService.Track]; reach for that directly
// when you need a custom event type or extra metrics.
func (s *EventsService) ThumbsUp(ctx context.Context, traceID string, feedback ...string) error {
	return s.vote(ctx, traceID, 1, feedback...)
}

// ThumbsDown records negative user feedback on a trace as the predefined
// thumbs_up_down event with vote=-1, plus an optional free-text feedback string.
// See [EventsService.ThumbsUp] for the capture-then-rate pattern.
//
//	err := lw.Events.ThumbsDown(ctx, traceID, "hallucinated the date")
func (s *EventsService) ThumbsDown(ctx context.Context, traceID string, feedback ...string) error {
	return s.vote(ctx, traceID, -1, feedback...)
}

// vote is the shared implementation behind ThumbsUp and ThumbsDown: it builds the
// thumbs_up_down event with the given vote and an optional feedback detail, then
// delegates to Track so the HTTP call lives in exactly one place.
func (s *EventsService) vote(ctx context.Context, traceID string, vote float64, feedback ...string) error {
	event := Event{
		Type:    "thumbs_up_down",
		Metrics: map[string]float64{"vote": vote},
	}
	if len(feedback) > 0 && feedback[0] != "" {
		event.Details = map[string]string{"feedback": feedback[0]}
	}
	return s.Track(ctx, traceID, event)
}
