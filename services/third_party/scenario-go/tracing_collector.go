package scenario

import (
	"context"
	"hash/maphash"
	"sync"
	"sync/atomic"

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
//
// Its state is sharded (by span id, by trace id and by thread) so parallel
// runs do not contend on one lock. No method holds two shard locks at once,
// except adoption, which takes the unthreaded lock, then a span shard, then
// a thread shard, an order no other path reverses.
type SpanCollector struct {
	spans   [collectorShards]spanShard
	traces  [collectorShards]traceShard
	threads [collectorShards]threadShard

	// unthreaded holds ended spans whose thread was unknown when they ended.
	unthreadedMu    sync.Mutex
	unthreaded      []sdktrace.ReadOnlySpan
	unthreadedCount atomic.Int32
}

const collectorShards = 32

// spanShard maps live and kept spans to their thread.
type spanShard struct {
	mu       sync.Mutex
	threadOf map[trace.SpanID]string
}

// traceShard holds every span id started, by trace id.
type traceShard struct {
	mu           sync.Mutex
	processSpans map[trace.TraceID]map[trace.SpanID]struct{}
}

// threadShard holds what is kept per thread.
type threadShard struct {
	mu sync.Mutex
	// byThread holds the ended spans of each thread, in end order.
	byThread map[string][]sdktrace.ReadOnlySpan
	// members holds every span id tied to each thread, live or ended, so
	// ClearThread releases them without a scan.
	members map[string][]trace.SpanID
	// claims holds the trace ids a remote fetcher claimed for a thread.
	claims map[string]map[trace.TraceID]struct{}
}

// NewSpanCollector returns an empty collector.
func NewSpanCollector() *SpanCollector { return &SpanCollector{} }

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

func (c *SpanCollector) spanShard(id trace.SpanID) *spanShard {
	return &c.spans[id[7]%collectorShards]
}

func (c *SpanCollector) traceShard(id trace.TraceID) *traceShard {
	return &c.traces[id[15]%collectorShards]
}

func (c *SpanCollector) threadShard(thread string) *threadShard {
	return &c.threads[maphash.String(threadSeed, thread)%collectorShards]
}

var threadSeed = maphash.MakeSeed()

// threadOf returns the thread a span is tied to, or "".
func (c *SpanCollector) threadOf(id trace.SpanID) string {
	sh := c.spanShard(id)
	sh.mu.Lock()
	defer sh.mu.Unlock()
	return sh.threadOf[id]
}

// tie ties a span to a thread.
func (c *SpanCollector) tie(id trace.SpanID, thread string) {
	sh := c.spanShard(id)
	sh.mu.Lock()
	known := sh.threadOf[id] == thread
	if !known {
		if sh.threadOf == nil {
			sh.threadOf = map[trace.SpanID]string{}
		}
		sh.threadOf[id] = thread
	}
	sh.mu.Unlock()
	if known {
		return
	}
	th := c.threadShard(thread)
	th.mu.Lock()
	if th.members == nil {
		th.members = map[string][]trace.SpanID{}
	}
	th.members[thread] = append(th.members[thread], id)
	th.mu.Unlock()
}

// keep appends an ended span to its thread.
func (c *SpanCollector) keep(thread string, s sdktrace.ReadOnlySpan) {
	th := c.threadShard(thread)
	th.mu.Lock()
	if th.byThread == nil {
		th.byThread = map[string][]sdktrace.ReadOnlySpan{}
	}
	th.byThread[thread] = append(th.byThread[thread], s)
	th.mu.Unlock()
}

// OnStart implements sdktrace.SpanProcessor.
func (c *SpanCollector) OnStart(_ context.Context, s sdktrace.ReadWriteSpan) {
	sc := s.SpanContext()
	ts := c.traceShard(sc.TraceID())
	ts.mu.Lock()
	if ts.processSpans == nil {
		ts.processSpans = map[trace.TraceID]map[trace.SpanID]struct{}{}
	}
	ids := ts.processSpans[sc.TraceID()]
	if ids == nil {
		ids = map[trace.SpanID]struct{}{}
		ts.processSpans[sc.TraceID()] = ids
	}
	ids[sc.SpanID()] = struct{}{}
	ts.mu.Unlock()

	thread := threadAttribute(s)
	if thread == "" {
		thread = c.threadOf(s.Parent().SpanID())
	}
	if thread != "" {
		c.tie(sc.SpanID(), thread)
	}
}

// OnEnd implements sdktrace.SpanProcessor.
func (c *SpanCollector) OnEnd(s sdktrace.ReadOnlySpan) {
	id := s.SpanContext().SpanID()
	thread := threadAttribute(s)
	if thread == "" {
		thread = c.threadOf(id)
	}
	if thread == "" {
		thread = c.threadOf(s.Parent().SpanID())
	}
	if thread == "" {
		c.unthreadedMu.Lock()
		if len(c.unthreaded) >= maxUnthreadedSpans {
			copy(c.unthreaded, c.unthreaded[1:])
			c.unthreaded = c.unthreaded[:len(c.unthreaded)-1]
		}
		c.unthreaded = append(c.unthreaded, s)
		c.unthreadedCount.Store(int32(len(c.unthreaded)))
		c.unthreadedMu.Unlock()
		return
	}
	c.tie(id, thread)
	c.keep(thread, s)
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
	for i := range c.spans {
		sh := &c.spans[i]
		sh.mu.Lock()
		sh.threadOf = nil
		sh.mu.Unlock()
	}
	for i := range c.traces {
		sh := &c.traces[i]
		sh.mu.Lock()
		sh.processSpans = nil
		sh.mu.Unlock()
	}
	for i := range c.threads {
		sh := &c.threads[i]
		sh.mu.Lock()
		sh.byThread, sh.members, sh.claims = nil, nil, nil
		sh.mu.Unlock()
	}
	c.unthreadedMu.Lock()
	c.unthreaded = nil
	c.unthreadedCount.Store(0)
	c.unthreadedMu.Unlock()
	return nil
}

// ForceFlush implements sdktrace.SpanProcessor.
func (c *SpanCollector) ForceFlush(context.Context) error { return nil }

// SpansForThread returns the ended spans of a thread, in end order.
func (c *SpanCollector) SpansForThread(threadID string) []sdktrace.ReadOnlySpan {
	c.adoptUnthreaded()
	th := c.threadShard(threadID)
	th.mu.Lock()
	defer th.mu.Unlock()
	spans := th.byThread[threadID]
	out := make([]sdktrace.ReadOnlySpan, len(spans))
	copy(out, spans)
	return out
}

// adoptUnthreaded moves unthreaded spans whose parent has since been tied
// to a thread (a child that ended before its parent started being tracked)
// into that thread.
func (c *SpanCollector) adoptUnthreaded() {
	if c.unthreadedCount.Load() == 0 {
		return
	}
	c.unthreadedMu.Lock()
	defer c.unthreadedMu.Unlock()
	kept := c.unthreaded[:0]
	for _, s := range c.unthreaded {
		parent := s.Parent().SpanID()
		if thread := c.threadOf(parent); thread != "" && parent.IsValid() {
			c.tie(s.SpanContext().SpanID(), thread)
			c.keep(thread, s)
			continue
		}
		kept = append(kept, s)
	}
	clear(c.unthreaded[len(kept):])
	c.unthreaded = kept
	c.unthreadedCount.Store(int32(len(kept)))
}

// ClaimTraces marks trace ids as owned by a thread, so ClearThread releases
// their process-span entries even when no ended span ties them to it.
func (c *SpanCollector) ClaimTraces(threadID string, traceIDs []trace.TraceID) {
	th := c.threadShard(threadID)
	th.mu.Lock()
	defer th.mu.Unlock()
	if th.claims == nil {
		th.claims = map[string]map[trace.TraceID]struct{}{}
	}
	owned := th.claims[threadID]
	if owned == nil {
		owned = map[trace.TraceID]struct{}{}
		th.claims[threadID] = owned
	}
	for _, id := range traceIDs {
		owned[id] = struct{}{}
	}
}

// IsProcessSpan reports whether this process started the span itself.
func (c *SpanCollector) IsProcessSpan(traceID trace.TraceID, spanID trace.SpanID) bool {
	ts := c.traceShard(traceID)
	ts.mu.Lock()
	defer ts.mu.Unlock()
	_, ok := ts.processSpans[traceID][spanID]
	return ok
}

// RemoveSpan removes one span of a thread by id, for example a synthetic
// error span a trace fetcher retracts.
func (c *SpanCollector) RemoveSpan(threadID string, spanID trace.SpanID) {
	th := c.threadShard(threadID)
	th.mu.Lock()
	defer th.mu.Unlock()
	spans := th.byThread[threadID]
	kept := spans[:0]
	for _, s := range spans {
		if s.SpanContext().SpanID() != spanID {
			kept = append(kept, s)
		}
	}
	clear(spans[len(kept):])
	if th.byThread != nil {
		th.byThread[threadID] = kept
	}
}

// ClearThread drops everything kept for a thread. The runner calls it when
// a run ends, so the collector does not grow in long-lived processes.
func (c *SpanCollector) ClearThread(threadID string) {
	th := c.threadShard(threadID)
	th.mu.Lock()
	spans := th.byThread[threadID]
	members := th.members[threadID]
	claims := th.claims[threadID]
	delete(th.byThread, threadID)
	delete(th.members, threadID)
	delete(th.claims, threadID)
	th.mu.Unlock()

	for _, s := range spans {
		c.forgetTrace(s.SpanContext().TraceID())
	}
	for id := range claims {
		c.forgetTrace(id)
	}
	for _, id := range members {
		sh := c.spanShard(id)
		sh.mu.Lock()
		if sh.threadOf[id] == threadID {
			delete(sh.threadOf, id)
		}
		sh.mu.Unlock()
	}
}

func (c *SpanCollector) forgetTrace(id trace.TraceID) {
	ts := c.traceShard(id)
	ts.mu.Lock()
	delete(ts.processSpans, id)
	ts.mu.Unlock()
}
