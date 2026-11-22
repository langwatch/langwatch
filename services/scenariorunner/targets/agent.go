// Package targets holds the serialized target adapters a scenario run talks
// to: an HTTP endpoint, a prompt, a code or workflow agent on the engine, and
// a connected agent through the relay. Each is the Go port of the matching
// channel in apps/scenario-child and keeps its wire shape.
package targets

import (
	"context"
	"strings"

	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// Message is one conversation message as an adapter reads it.
type Message struct {
	Role string
	// Content is the text, or Raw holds structured content as JSON.
	Content string
	Raw     jsjson.Raw
	// ID, TraceID and Turn are what the scenario state stamps on a message.
	ID      string
	TraceID string
	Turn    *int
}

// TextContent is the content as text: the string, or the structured
// content's JSON.
func (m Message) TextContent() string {
	if m.Raw != "" {
		return string(m.Raw)
	}
	return m.Content
}

// IsStructured reports content that is not a plain string.
func (m Message) IsStructured() bool { return m.Raw != "" }

// JSON is the message in the shape the Node child hands a target: role,
// content, then the state's stamps.
func (m Message) JSON() *jsjson.Object {
	obj := jsjson.NewObject().Set("role", m.Role)
	if m.Raw != "" {
		obj.Set("content", m.Raw)
	} else {
		obj.Set("content", m.Content)
	}
	if m.TraceID != "" {
		obj.Set("traceId", m.TraceID)
	}
	if m.ID != "" {
		obj.Set("id", m.ID)
	}
	if m.Turn != nil {
		obj.Set("turn", float64(*m.Turn))
	}
	return obj
}

// MessagesJSON is JSON.stringify of a conversation.
func MessagesJSON(messages []Message) jsjson.Raw {
	arr := make([]any, len(messages))
	for i, m := range messages {
		arr[i] = m.JSON()
	}
	return jsjson.Raw(jsjson.Stringify(arr))
}

// Turn is one call of the agent under test.
type Turn struct {
	ThreadID    string
	Messages    []Message
	NewMessages []Message
}

// lastUserMessage is the last user message, if any.
func (t Turn) lastUserMessage() (Message, bool) {
	for i := len(t.Messages) - 1; i >= 0; i-- {
		if t.Messages[i].Role == "user" {
			return t.Messages[i], true
		}
	}
	return Message{}, false
}

// Instance is the connected agent process that answered a turn.
type Instance struct {
	Hostname string
	// Label is nil when the instance carries none.
	Label *string
}

// Agent is a target adapter.
type Agent interface {
	// Name is the adapter's name, as the Node child names the class.
	Name() string
	// Call runs one turn and returns the reply text.
	Call(ctx context.Context, turn Turn) (string, error)
}

// Served is implemented by an adapter whose turns an instance answers.
type Served interface {
	ServedInstance() *Instance
}

// TraceContext is the trace a turn runs in, as propagation headers.
type TraceContext struct {
	Headers     map[string]string
	TraceID     string
	Traceparent string
}

// traceContextOf captures the active span's trace once per turn.
func traceContextOf(ctx context.Context) TraceContext {
	carrier := propagation.MapCarrier{}
	if trace.SpanContextFromContext(ctx).IsValid() {
		propagation.TraceContext{}.Inject(ctx, carrier)
	}
	tc := TraceContext{Headers: map[string]string(carrier), Traceparent: carrier["traceparent"]}
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		tc.TraceID = sc.TraceID().String()
	}
	return tc
}

// trimTrailingSlash drops one trailing slash, as `url.replace(/\/$/, "")`.
func trimTrailingSlash(s string) string { return strings.TrimSuffix(s, "/") }
