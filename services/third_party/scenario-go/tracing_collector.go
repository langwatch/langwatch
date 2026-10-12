package scenario

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// threadIDKey is the attribute that ties a span to a scenario thread.
const threadIDKey = "langwatch.thread.id"

// maxUnthreadedSpans bounds the spans kept that belong to no thread yet
// (spans of unrelated instrumentation), so a long-lived process cannot grow
// without bound.
const maxUnthreadedSpans = 10_000

// SpanCollector is a span processor that keeps ended spans per scenario
// thread for the judge and the state views. A span belongs to a thread when
// it or an ancestor carries langwatch.thread.id; the thread is resolved when
// the span starts (its parent is known by then) and confirmed when it ends,
// so a lookup is a map read instead of a scan of every span.
//
// It also remembers every span id the process started, so a remote trace
// fetcher can tell the process's own spans from remote ones.
type SpanCollector struct {
	mu sync.Mutex
	// threadOf maps live and kept spans to their thread.
	threadOf map[trace.SpanID]string
	// byThread holds the ended spans of each thread.
	byThread map[string][]sdktrace.ReadOnlySpan
	// unthreaded holds ended spans whose thread was unknown when they ended.
	unthreaded []sdktrace.ReadOnlySpan
	// processSpans holds every span id started, by trace id.
	processSpans map[trace.TraceID]map[trace.SpanID]struct{}
	// claims holds the trace ids a remote fetcher claimed for a thread.
	claims map[string]map[trace.TraceID]struct{}
}

// NewSpanCollector returns an empty collector.
func NewSpanCollector() *SpanCollector {
	return &SpanCollector{
		threadOf:     map[trace.SpanID]string{},
		byThread:     map[string][]sdktrace.ReadOnlySpan{},
		processSpans: map[trace.TraceID]map[trace.SpanID]struct{}{},
		claims:       map[string]map[trace.TraceID]struct{}{},
	}
}

var (
	defaultCollectorOnce sync.Once
	defaultCollector     *SpanCollector
)

// DefaultSpanCollector is the collector SetupScenarioTracing registers and
// the judge reads.
func DefaultSpanCollector() *SpanCollector {
	defaultCollectorOnce.Do(func() { defaultCollector = NewSpanCollector() })
	return defaultCollector
}

// OnStart implements sdktrace.SpanProcessor.
func (c *SpanCollector) OnStart(_ context.Context, s sdktrace.ReadWriteSpan) {
	sc := s.SpanContext()
	thread := threadAttribute(s)
	c.mu.Lock()
	defer c.mu.Unlock()
	ids := c.processSpans[sc.TraceID()]
	if ids == nil {
		ids = map[trace.SpanID]struct{}{}
		c.processSpans[sc.TraceID()] = ids
	}
	ids[sc.SpanID()] = struct{}{}
	if thread == "" {
		thread = c.threadOf[s.Parent().SpanID()]
	}
	if thread != "" {
		c.threadOf[sc.SpanID()] = thread
	}
}

// OnEnd implements sdktrace.SpanProcessor.
func (c *SpanCollector) OnEnd(s sdktrace.ReadOnlySpan) {
	thread := threadAttribute(s)
	c.mu.Lock()
	defer c.mu.Unlock()
	if thread == "" {
		thread = c.threadOf[s.SpanContext().SpanID()]
	}
	if thread == "" {
		thread = c.threadOf[s.Parent().SpanID()]
	}
	if thread == "" {
		if len(c.unthreaded) >= maxUnthreadedSpans {
			copy(c.unthreaded, c.unthreaded[1:])
			c.unthreaded = c.unthreaded[:len(c.unthreaded)-1]
		}
		c.unthreaded = append(c.unthreaded, s)
		return
	}
	c.threadOf[s.SpanContext().SpanID()] = thread
	c.byThread[thread] = append(c.byThread[thread], s)
}

// Add records an already ended span, such as a remote span a trace fetcher
// converted. Tag it with langwatch.thread.id to tie it to a thread.
func (c *SpanCollector) Add(s sdktrace.ReadOnlySpan) { c.OnEnd(s) }

func threadAttribute(s interface {
	Attributes() []attribute.KeyValue
}) string {
	for _, kv := range s.Attributes() {
		if kv.Key == threadIDKey {
			return kv.Value.AsString()
		}
	}
	return ""
}

// Shutdown implements sdktrace.SpanProcessor.
func (c *SpanCollector) Shutdown(context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	*c = SpanCollector{
		threadOf:     map[trace.SpanID]string{},
		byThread:     map[string][]sdktrace.ReadOnlySpan{},
		processSpans: map[trace.TraceID]map[trace.SpanID]struct{}{},
		claims:       map[string]map[trace.TraceID]struct{}{},
	}
	return nil
}

// ForceFlush implements sdktrace.SpanProcessor.
func (c *SpanCollector) ForceFlush(context.Context) error { return nil }

// SpansForThread returns the ended spans of a thread, in end order.
func (c *SpanCollector) SpansForThread(threadID string) []sdktrace.ReadOnlySpan {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.adoptUnthreadedLocked()
	spans := c.byThread[threadID]
	out := make([]sdktrace.ReadOnlySpan, len(spans))
	copy(out, spans)
	return out
}

// adoptUnthreadedLocked moves unthreaded spans whose parent has since been
// tied to a thread (a child that ended before its parent started being
// tracked) into that thread.
func (c *SpanCollector) adoptUnthreadedLocked() {
	if len(c.unthreaded) == 0 {
		return
	}
	kept := c.unthreaded[:0]
	for _, s := range c.unthreaded {
		if thread := c.threadOf[s.Parent().SpanID()]; thread != "" && s.Parent().SpanID().IsValid() {
			c.threadOf[s.SpanContext().SpanID()] = thread
			c.byThread[thread] = append(c.byThread[thread], s)
			continue
		}
		kept = append(kept, s)
	}
	clear(c.unthreaded[len(kept):])
	c.unthreaded = kept
}

// ClaimTraces marks trace ids as owned by a thread, so ClearThread releases
// their process-span entries even when no ended span ties them to it.
func (c *SpanCollector) ClaimTraces(threadID string, traceIDs []trace.TraceID) {
	c.mu.Lock()
	defer c.mu.Unlock()
	owned := c.claims[threadID]
	if owned == nil {
		owned = map[trace.TraceID]struct{}{}
		c.claims[threadID] = owned
	}
	for _, id := range traceIDs {
		owned[id] = struct{}{}
	}
}

// IsProcessSpan reports whether this process started the span itself.
func (c *SpanCollector) IsProcessSpan(traceID trace.TraceID, spanID trace.SpanID) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.processSpans[traceID][spanID]
	return ok
}

// RemoveSpan removes one span of a thread by id, for example a synthetic
// error span a trace fetcher retracts.
func (c *SpanCollector) RemoveSpan(threadID string, spanID trace.SpanID) {
	c.mu.Lock()
	defer c.mu.Unlock()
	spans := c.byThread[threadID]
	kept := spans[:0]
	for _, s := range spans {
		if s.SpanContext().SpanID() != spanID {
			kept = append(kept, s)
		}
	}
	clear(spans[len(kept):])
	c.byThread[threadID] = kept
}

// ClearThread drops everything kept for a thread. The runner calls it when
// a run ends, so the collector does not grow in long-lived processes.
func (c *SpanCollector) ClearThread(threadID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, s := range c.byThread[threadID] {
		delete(c.processSpans, s.SpanContext().TraceID())
		delete(c.threadOf, s.SpanContext().SpanID())
	}
	for id := range c.claims[threadID] {
		delete(c.processSpans, id)
	}
	delete(c.claims, threadID)
	delete(c.byThread, threadID)
	for id, t := range c.threadOf {
		if t == threadID {
			delete(c.threadOf, id)
		}
	}
}
