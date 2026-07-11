package otlpreceiver

import (
	"fmt"
	"time"
)

// Correlation attribute keys. The manager stamps AttrConversationID onto each
// worker's OTel RESOURCE at spawn (it rides in OPENCODE_RESOURCE_ATTRIBUTES /
// the CLI's OTEL_RESOURCE_ATTRIBUTES), so every span a worker exports arrives
// already tagged. They are exported so the injection site and the extraction
// site can never drift apart.
const (
	// AttrConversationID identifies the Langy conversation (the worker). This is
	// the ONLY key correlation depends on. It is the one id available at spawn —
	// buildWorkerEnv already takes conversationID — and it is sufficient on its
	// own because the control plane admits at most one in-flight turn per
	// conversation (a second concurrent turn is refused with a 409). So the
	// conversation identifies its active turn unambiguously, and the manager maps
	// conversation -> currently-streaming turn on the way out.
	AttrConversationID = "langy.conversation_id"

	// AttrTurnID is OPTIONAL. A worker serves a conversation and its turns arrive
	// later, so the turn id is NOT known at spawn and is normally ABSENT from the
	// resource. When a producer does happen to set it (a future per-turn tracer,
	// or the `langwatch` CLI invoked mid-turn), it is passed through on the Event;
	// its absence is the ordinary case and never disqualifies a span.
	AttrTurnID = "langy.turn_id"
)

// ResourceAttributes renders the correlation attributes in the `k=v,k=v` form
// both OTEL_RESOURCE_ATTRIBUTES and opencode's OPENCODE_RESOURCE_ATTRIBUTES
// take. Callers append it to whatever other resource attributes they already
// set. turnID is optional — pass "" (the normal case at spawn time) and only the
// conversation id is emitted.
func ResourceAttributes(conversationID, turnID string) string {
	attrs := fmt.Sprintf("%s=%s", AttrConversationID, conversationID)
	if turnID != "" {
		attrs += fmt.Sprintf(",%s=%s", AttrTurnID, turnID)
	}
	return attrs
}

// Kind is the coarse span classification the UI actually branches on. It is
// deliberately thin: three buckets, no taxonomy. Anything finer-grained (which
// tool, which model, which langwatch verb) is already in Attributes, and the
// consumer is better placed than we are to decide what it means.
type Kind string

const (
	// KindLLM is a gen-AI model call — the span carrying model, tokens, latency.
	KindLLM Kind = "llm"
	// KindTool is a tool/function execution (opencode's tools, and the
	// `langwatch` CLI's own spans once it emits them).
	KindTool Kind = "tool"
	// KindOther is everything else: HTTP clients, internal plumbing, spans we
	// have no opinion about. Forwarded to the sink all the same — the consumer
	// filters.
	KindOther Kind = "other"
)

// StatusCode is the span status, flattened to the three OTel values.
type StatusCode string

const (
	StatusUnset StatusCode = "unset"
	StatusOK    StatusCode = "ok"
	StatusError StatusCode = "error"
)

// Status is a span's outcome.
type Status struct {
	Code    StatusCode `json:"code"`
	Message string     `json:"message,omitempty"`
}

// SpanEvent is a point-in-time event on a span. This is the path the `langwatch`
// CLI's progress events take: it emits them as span events, they land here
// verbatim, and the manager can turn each into an incremental NDJSON frame
// without the receiver knowing anything about the CLI's vocabulary.
type SpanEvent struct {
	Name       string         `json:"name"`
	Time       time.Time      `json:"time"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

// Event is one decoded, correlated span — the neutral currency between the
// receiver and whatever renders it. JSON-serialisable by construction: the
// manager marshals it (or a projection of it) straight into a `langy.*` NDJSON
// frame.
//
// Attributes is the flattened, verbatim attribute map (resource attributes
// merged under the span's own, span wins on conflict). Everything the receiver
// declines to interpret still reaches the consumer through it — `gen_ai.*`,
// `langwatch.resource` / `langwatch.verb`, opencode internals, whatever comes
// next. That is the whole point: we do not gatekeep meaning.
type Event struct {
	// ConversationID is always set — an uncorrelated span never becomes an Event.
	ConversationID string `json:"conversationId"`
	// TurnID is usually empty; see AttrTurnID. The manager resolves the turn from
	// the conversation, so this is a pass-through, not a routing key.
	TurnID string `json:"turnId,omitempty"`

	TraceID      string `json:"traceId"`
	SpanID       string `json:"spanId"`
	ParentSpanID string `json:"parentSpanId,omitempty"`

	Name string `json:"name"`
	// Kind is our coarse classification (llm / tool / other).
	Kind Kind `json:"kind"`
	// SpanKind is OTel's own span kind (internal / client / server / ...),
	// lower-cased. Kept separate from Kind because they answer different
	// questions and conflating them would lose both.
	SpanKind string `json:"spanKind,omitempty"`

	StartTime  time.Time `json:"startTime"`
	EndTime    time.Time `json:"endTime"`
	DurationMS float64   `json:"durationMs"`

	Status Status `json:"status"`

	Attributes map[string]any `json:"attributes,omitempty"`
	Events     []SpanEvent    `json:"events,omitempty"`
}
