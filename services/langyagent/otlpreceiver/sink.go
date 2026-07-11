package otlpreceiver

import "context"

// Sink receives decoded, conversation-correlated spans. The manager implements
// it by fanning each Event onto the NDJSON stream of the turn it belongs to.
//
// The interface lives HERE and is implemented THERE on purpose: the receiver
// must not import workerpool (that is an import cycle waiting to happen, and it
// would couple a transport-shaped package to the process pool).
//
// CONTRACT: OnSpans is called inline on the OTLP request goroutine, so an
// implementation MUST NOT block — a worker's exporter is waiting on the
// response, and its next batch queues behind this one. Do a non-blocking send
// onto the turn's channel and drop (or count) on a full buffer; do not do I/O.
//
// The slice may mix conversations and turns (one OTLP batch can carry spans from
// several); route per Event, do not assume the batch is homogeneous. Every Event
// is guaranteed to have a non-empty ConversationID — uncorrelated spans are
// forwarded upstream but never reach a Sink.
type Sink interface {
	OnSpans(ctx context.Context, events []Event)
}

// SinkFunc adapts a plain function to Sink.
type SinkFunc func(ctx context.Context, events []Event)

// OnSpans implements Sink.
func (f SinkFunc) OnSpans(ctx context.Context, events []Event) { f(ctx, events) }
