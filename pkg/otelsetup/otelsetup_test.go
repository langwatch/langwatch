package otelsetup

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// capturingHandler records every error it receives so tests can assert
// the startupErrorHandler's filter is actually gating what reaches the
// delegate logger.
type capturingHandler struct {
	errs []error
}

func (c *capturingHandler) Handle(err error) { c.errs = append(c.errs, err) }

func TestStartupErrorHandler_SuppressesTransportAuthErrorsInGraceWindow(t *testing.T) {
	captured := &capturingHandler{}
	h := newStartupErrorHandler(captured, 10*time.Second)

	// All of these should be suppressed: the gateway races its OTLP
	// exporter against the control-plane coming up, and the default
	// handler emits a WARN for each one — floods logs for seconds.
	h.Handle(errors.New(`exporter POST http://cp/v1/traces returned 401 Unauthorized`))
	h.Handle(errors.New(`net/http: dial tcp 127.0.0.1:5560: connection refused`))
	h.Handle(errors.New(`no such host: langwatch-saas.internal`))
	h.Handle(errors.New(`exporter returned 403`))

	if len(captured.errs) != 0 {
		t.Fatalf("expected all startup-noise errors to be suppressed, got %d: %v", len(captured.errs), captured.errs)
	}
}

func TestStartupErrorHandler_PassesRealErrorsThroughEvenInGraceWindow(t *testing.T) {
	captured := &capturingHandler{}
	h := newStartupErrorHandler(captured, 10*time.Second)

	// Non-transport errors are always surfaced — an OTLP protocol-level
	// issue isn't startup noise, it's a real bug that needs to page.
	realErr := errors.New("sdk/trace: span exporter returned nil context")
	h.Handle(realErr)

	if len(captured.errs) != 1 || !errors.Is(captured.errs[0], realErr) {
		t.Fatalf("expected real error to propagate, got: %v", captured.errs)
	}
}

func TestStartupErrorHandler_PassesAuthErrorsAfterGraceWindowElapses(t *testing.T) {
	captured := &capturingHandler{}
	h := newStartupErrorHandler(captured, 10*time.Millisecond)

	// After the grace window lapses, 401s become real and must surface —
	// they likely mean credentials rotated / got revoked at runtime.
	time.Sleep(20 * time.Millisecond)
	authErr := errors.New(`POST /v1/traces returned 401 Unauthorized`)
	h.Handle(authErr)

	if len(captured.errs) != 1 || !errors.Is(captured.errs[0], authErr) {
		t.Fatalf("expected post-grace auth error to surface, got: %v", captured.errs)
	}
}

func TestStartupErrorHandler_MarkHealthyFlipsFilterOff(t *testing.T) {
	captured := &capturingHandler{}
	h := newStartupErrorHandler(captured, 1*time.Hour) // effectively never expires

	h.Handle(errors.New(`POST /v1/traces returned 401 Unauthorized`))
	if len(captured.errs) != 0 {
		t.Fatalf("expected 401 to be swallowed before markHealthy, got: %v", captured.errs)
	}

	h.markHealthy()

	// Second 401 after the exporter has succeeded once should flow through —
	// something new is wrong, not just startup race.
	newAuthErr := errors.New(`POST /v1/traces returned 401 Unauthorized`)
	h.Handle(newAuthErr)
	if len(captured.errs) != 1 || !errors.Is(captured.errs[0], newAuthErr) {
		t.Fatalf("expected post-healthy 401 to surface, got: %v", captured.errs)
	}
}

func TestHealthyExporterWrap_CallsOnHealthyOnFirstSuccessfulExport(t *testing.T) {
	inner := &fakeExporter{}
	var called atomic.Int32
	wrap := healthyExporterWrap(inner, func() { called.Add(1) })

	// First export returns success → onHealthy should be invoked once.
	if err := wrap.ExportSpans(context.Background(), nil); err != nil {
		t.Fatalf("unexpected export error: %v", err)
	}
	if got := called.Load(); got != 1 {
		t.Fatalf("expected onHealthy called once, got %d", got)
	}

	// Subsequent successful exports must NOT re-fire — sync.Once guards it.
	if err := wrap.ExportSpans(context.Background(), nil); err != nil {
		t.Fatalf("unexpected export error: %v", err)
	}
	if got := called.Load(); got != 1 {
		t.Fatalf("expected onHealthy to remain at 1 after second success, got %d", got)
	}
}

func TestHealthyExporterWrap_DoesNotCallOnHealthyOnErrors(t *testing.T) {
	inner := &fakeExporter{err: errors.New("transport failure")}
	var called atomic.Int32
	wrap := healthyExporterWrap(inner, func() { called.Add(1) })

	for i := 0; i < 3; i++ {
		if err := wrap.ExportSpans(context.Background(), nil); err == nil {
			t.Fatalf("expected wrapped error on call %d", i)
		}
	}
	if got := called.Load(); got != 0 {
		t.Fatalf("expected onHealthy never called when exports fail, got %d", got)
	}
}

type fakeExporter struct {
	err error
}

func (f *fakeExporter) ExportSpans(_ context.Context, _ []sdktrace.ReadOnlySpan) error { return f.err }
func (f *fakeExporter) Shutdown(_ context.Context) error                               { return nil }

// TestProvider_ForceFlushIsSafeOnNoopProvider pins the contract that
// callers can `defer p.ForceFlush(ctx)` even when telemetry isn't
// configured (e.g. local dev with OTLP_ENDPOINT unset). A naked
// dereference of `p.tp` would panic — guard it.
func TestProvider_ForceFlushIsSafeOnNoopProvider(t *testing.T) {
	p := &Provider{} // no tracer provider, mirroring noop construction
	if err := p.ForceFlush(context.Background()); err != nil {
		t.Fatalf("noop ForceFlush should be a no-op, got %v", err)
	}
}

// TestProvider_ForceFlushDelegatesToTracerProvider verifies the call
// reaches the SDK tracer provider's ForceFlush. We use a real
// tracer-provider with a counting span processor and a long batch
// timeout so only ForceFlush triggers an export call. Pins the parity
// claim from langwatch_nlp commit 1f1d62f55: the per-request flush
// must actually push pending spans to the exporter, not just no-op.
func TestProvider_ForceFlushDelegatesToTracerProvider(t *testing.T) {
	exp := &countingExporter{}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp,
			sdktrace.WithBatchTimeout(time.Hour), // long timeout so only ForceFlush triggers
		),
	)
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })

	tracer := tp.Tracer("test")
	_, span := tracer.Start(context.Background(), "test-span")
	span.End()

	p := &Provider{tp: tp}
	before := exp.calls.Load()
	if err := p.ForceFlush(context.Background()); err != nil {
		t.Fatalf("ForceFlush returned error: %v", err)
	}
	after := exp.calls.Load()
	if after <= before {
		t.Fatalf("ForceFlush should have triggered an export batch; got calls before=%d after=%d", before, after)
	}
}

// countingExporter records each ExportSpans call so tests can assert
// flush behavior.
type countingExporter struct {
	calls atomic.Int32
}

func (c *countingExporter) ExportSpans(_ context.Context, _ []sdktrace.ReadOnlySpan) error {
	c.calls.Add(1)
	return nil
}
func (c *countingExporter) Shutdown(_ context.Context) error { return nil }
