package app

import (
	"strings"
	"time"
)

// ResponsesStreamEvent is one SSE event emitted by /v1/responses in
// stream mode. The Responses API uses typed events (`response.created`,
// `response.output_text.delta`, `response.completed`, …) — we emit the
// minimal sequence needed for clients to reconstruct the same payload as
// the non-stream call.
type ResponsesStreamEvent struct {
	Event string         `json:"-"`
	Data  map[string]any `json:"-"`
}

// BuildResponsesStreamEvents returns the SSE event sequence for a
// request. Keeping the events as `map[string]any` (rather than a forest
// of typed structs) keeps the file small — the Responses API's event
// catalogue is long and most clients only switch on `event:` + a couple
// of `data` fields.
func BuildResponsesStreamEvents(req ResponsesRequest, now time.Time) []ResponsesStreamEvent {
	result := BuildResponsesResult(req, now)
	model, _ := Normalize(req.Model)
	// Use the same id as the non-stream builder so clients reconstructing
	// the response see consistent ids across the two endpoints. Since
	// BuildResponsesResult already stamped, derive textItemID by stripping
	// the "resp_noai_" prefix and reusing the suffix.
	textItemID := "msg_noai_" + strings.TrimPrefix(result.ID, "resp_noai_")

	events := []ResponsesStreamEvent{
		{Event: "response.created", Data: map[string]any{"response": minimalResponseEnvelope(result, "in_progress")}},
		{Event: "response.in_progress", Data: map[string]any{"response": minimalResponseEnvelope(result, "in_progress")}},
		{Event: "response.output_item.added", Data: map[string]any{
			"output_index": 0,
			"item": map[string]any{
				"id": textItemID, "type": "message", "role": "assistant", "content": []any{},
			},
		}},
		{Event: "response.content_part.added", Data: map[string]any{
			"output_index": 0, "item_id": textItemID, "content_index": 0,
			"part": map[string]any{"type": "output_text", "text": ""},
		}},
		{Event: "response.output_text.delta", Data: map[string]any{
			"output_index": 0, "item_id": textItemID, "content_index": 0,
			"delta": result.OutputText,
		}},
		{Event: "response.output_text.done", Data: map[string]any{
			"output_index": 0, "item_id": textItemID, "content_index": 0,
			"text": result.OutputText,
		}},
	}

	if model.HasAudioOutput() || responsesAsksForAudio(req) {
		events = append(events, ResponsesStreamEvent{
			Event: "response.output_audio.delta",
			Data: map[string]any{
				"output_index": 0, "item_id": textItemID, "content_index": 1,
				"delta": SilentWavBase64,
			},
		})
		events = append(events, ResponsesStreamEvent{
			Event: "response.output_audio.done",
			Data: map[string]any{
				"output_index": 0, "item_id": textItemID, "content_index": 1,
				"audio": SilentWavBase64, "transcript": result.OutputText,
			},
		})
	}

	events = append(events,
		ResponsesStreamEvent{Event: "response.output_item.done", Data: map[string]any{
			"output_index": 0,
			"item": map[string]any{
				"id":      textItemID,
				"type":    "message",
				"role":    "assistant",
				"content": result.Output[0].Content,
			},
		}},
		ResponsesStreamEvent{Event: "response.completed", Data: map[string]any{
			"response": minimalResponseEnvelope(result, "completed"),
		}},
	)
	return events
}

// minimalResponseEnvelope projects the parts of ResponsesResult that
// the Responses-API events embed. The non-streaming response already
// carries the full payload — repeating every field on every event is
// noisy and not what real OpenAI does.
func minimalResponseEnvelope(r ResponsesResult, status string) map[string]any {
	return map[string]any{
		"id":         r.ID,
		"object":     r.Object,
		"created_at": r.CreatedAt,
		"status":     status,
		"model":      r.Model,
	}
}
