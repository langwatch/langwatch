package otelsetup

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// stubProcessor records every span it sees and the api_key it was
// constructed with. Stands in for the real per-tenant
// otlptracehttp/BatchSpanProcessor pair so tests can assert routing
// without spinning up an HTTPS endpoint.
type stubProcessor struct {
	apiKey string
	mu     sync.Mutex
	ended  []sdktrace.ReadOnlySpan
	flush  atomic.Int32
	shut   atomic.Int32
}

func (s *stubProcessor) OnStart(context.Context, sdktrace.ReadWriteSpan) {}
func (s *stubProcessor) OnEnd(span sdktrace.ReadOnlySpan) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ended = append(s.ended, span)
}
func (s *stubProcessor) ForceFlush(context.Context) error { s.flush.Add(1); return nil }
func (s *stubProcessor) Shutdown(context.Context) error   { s.shut.Add(1); return nil }

func (s *stubProcessor) seen() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.ended)
}

// makeRouterWithStubs returns a router whose per-tenant processors
// are stubs, plus a map keyed by api_key so tests can inspect the
// routing.
func makeRouterWithStubs() (*TenantRouter, *sync.Map) {
	stubs := &sync.Map{}
	r := NewTenantRouter("https://test.local/api/otel/v1/traces")
	r.newProcessor = func(_, apiKey string) (sdktrace.SpanProcessor, error) {
		s := &stubProcessor{apiKey: apiKey}
		stubs.Store(apiKey, s)
		return s, nil
	}
	return r, stubs
}

// runSpan starts and ends one span on a router-backed TracerProvider.
// The TracerProvider is intentionally NOT shut down — that would fan
// out Shutdown to every cached per-tenant processor and double-count
// in tests that exercise router-level Shutdown directly.
func runSpan(t *testing.T, r *TenantRouter, ctx context.Context, name string) {
	t.Helper()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(r))
	tracer := tp.Tracer("test")
	_, span := tracer.Start(ctx, name)
	span.End()
}

// TestTenantRouter_RoutesByContextAPIKey is the happy path: a span
// started with api_key=K_A in context lands on the K_A processor and
// nowhere else.
func TestTenantRouter_RoutesByContextAPIKey(t *testing.T) {
	r, stubs := makeRouterWithStubs()

	ctx := context.WithValue(context.Background(), APIKeyContextKey{}, "key-A")
	runSpan(t, r, ctx, "span-A")

	v, ok := stubs.Load("key-A")
	require.True(t, ok, "key-A processor should have been created")
	assert.Equal(t, 1, v.(*stubProcessor).seen())
}

// TestTenantRouter_DropsSpansWithoutAPIKey: spans started with no
// api_key in context (and no parent that has one) are dropped — we
// have no safe attribution path. The Lambda-reuse threat model says
// a leaked-tenant attribution is worse than a dropped span.
func TestTenantRouter_DropsSpansWithoutAPIKey(t *testing.T) {
	r, stubs := makeRouterWithStubs()

	runSpan(t, r, context.Background(), "orphan-span")

	count := 0
	stubs.Range(func(_, _ any) bool { count++; return true })
	assert.Equal(t, 0, count, "no per-tenant processor should be created for an unauth'd span")
}

// TestTenantRouter_TwoTenantsTwoProcessors: spans from two different
// tenants each land on their own processor, never on the wrong one.
// Pins the core multi-tenant safety claim.
func TestTenantRouter_TwoTenantsTwoProcessors(t *testing.T) {
	r, stubs := makeRouterWithStubs()

	ctxA := context.WithValue(context.Background(), APIKeyContextKey{}, "key-A")
	ctxB := context.WithValue(context.Background(), APIKeyContextKey{}, "key-B")
	runSpan(t, r, ctxA, "span-A")
	runSpan(t, r, ctxB, "span-B")

	a, _ := stubs.Load("key-A")
	b, _ := stubs.Load("key-B")
	require.NotNil(t, a)
	require.NotNil(t, b)
	assert.Equal(t, 1, a.(*stubProcessor).seen(), "key-A processor must see only A's span")
	assert.Equal(t, 1, b.(*stubProcessor).seen(), "key-B processor must see only B's span")
}

// TestTenantRouter_ConcurrentTenantsNoCrosstalk simulates the Lambda-
// reuse threat model: many concurrent goroutines, each with its own
// tenant context. Asserts each tenant's processor receives exactly
// the count of spans started with its api_key — no cross-tenant leak.
func TestTenantRouter_ConcurrentTenantsNoCrosstalk(t *testing.T) {
	r, stubs := makeRouterWithStubs()

	const tenants = 8
	const perTenant = 32

	var wg sync.WaitGroup
	for ti := 0; ti < tenants; ti++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			apiKey := apiKeyForIdx(idx)
			ctx := context.WithValue(context.Background(), APIKeyContextKey{}, apiKey)
			tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(r))
			defer func() { _ = tp.Shutdown(context.Background()) }()
			tracer := tp.Tracer("test")
			for i := 0; i < perTenant; i++ {
				_, span := tracer.Start(ctx, "span")
				span.End()
			}
		}(ti)
	}
	wg.Wait()

	for ti := 0; ti < tenants; ti++ {
		apiKey := apiKeyForIdx(ti)
		v, ok := stubs.Load(apiKey)
		require.True(t, ok, "processor for %s should exist", apiKey)
		assert.Equal(t, perTenant, v.(*stubProcessor).seen(),
			"tenant %s must see exactly its own %d spans, no cross-talk", apiKey, perTenant)
	}
}

// TestTenantRouter_ChildSpanInheritsParentAuth: a child span started
// in a context that no longer carries the api_key still routes to
// the right tenant by inheriting from the parent span's recorded
// api_key. Covers the edge case of goroutines that didn't propagate
// ctx but did propagate the SpanContext.
func TestTenantRouter_ChildSpanInheritsParentAuth(t *testing.T) {
	r, stubs := makeRouterWithStubs()

	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(r))
	defer func() { _ = tp.Shutdown(context.Background()) }()
	tracer := tp.Tracer("test")

	parentCtx := context.WithValue(context.Background(), APIKeyContextKey{}, "key-X")
	// Discard the returned context: the child below intentionally builds
	// a fresh context from the span context (not from this returned ctx)
	// to repro the goroutine-without-ctx-propagation scenario.
	_, parent := tracer.Start(parentCtx, "parent")

	// Start a child but DROP the api_key from context — only the
	// span context carries forward. Production case: goroutine that
	// receives a trace.SpanContext via baggage but no apiKeyCtx.
	childCtxNoAPIKey := trace.ContextWithSpan(context.Background(), parent)
	_, child := tracer.Start(childCtxNoAPIKey, "child")
	child.End()
	parent.End()

	v, ok := stubs.Load("key-X")
	require.True(t, ok)
	// Both parent and child should land on the same tenant.
	assert.Equal(t, 2, v.(*stubProcessor).seen(),
		"parent + child must both route to key-X via parent-span fallback")
}

// TestTenantRouter_ForceFlushFansOut: all per-tenant processors are
// flushed when the router's ForceFlush is invoked.
func TestTenantRouter_ForceFlushFansOut(t *testing.T) {
	r, stubs := makeRouterWithStubs()

	for _, k := range []string{"key-A", "key-B"} {
		ctx := context.WithValue(context.Background(), APIKeyContextKey{}, k)
		runSpan(t, r, ctx, "span")
	}

	require.NoError(t, r.ForceFlush(context.Background()))

	for _, k := range []string{"key-A", "key-B"} {
		v, _ := stubs.Load(k)
		assert.Equal(t, int32(1), v.(*stubProcessor).flush.Load(),
			"ForceFlush should fan out to %s", k)
	}
}

// TestTenantRouter_ShutdownFansOut: same as ForceFlush but for
// Shutdown — every per-tenant processor sees its Shutdown call.
func TestTenantRouter_ShutdownFansOut(t *testing.T) {
	r, stubs := makeRouterWithStubs()

	for _, k := range []string{"key-A", "key-B"} {
		ctx := context.WithValue(context.Background(), APIKeyContextKey{}, k)
		runSpan(t, r, ctx, "span")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(t, r.Shutdown(ctx))

	for _, k := range []string{"key-A", "key-B"} {
		v, _ := stubs.Load(k)
		assert.Equal(t, int32(1), v.(*stubProcessor).shut.Load(),
			"Shutdown should fan out to %s", k)
	}
}

func apiKeyForIdx(i int) string {
	return "key-tenant-" + string(rune('A'+i))
}
