package clog

import (
	"context"
	"fmt"
	"runtime"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

// HandlePanic recovers from a panic, logs it with a stack trace, and
// optionally re-panics. Use propagate=true in HTTP handlers where
// upstream recovery exists (net/http catches panics per-request).
// Use propagate=false at service root to log and exit cleanly.
//
// Usage:
//
//	defer clog.HandlePanic(ctx, false)
func HandlePanic(ctx context.Context, propagate bool) {
	v := recover()
	if v == nil {
		return
	}

	LogPanic(ctx, v)

	if propagate {
		panic(v)
	}
}

var (
	panicMeterOnce sync.Once
	panicCounter   metric.Int64Counter
)

// recoveredPanicCounter lazily builds the recovered-panic counter against the
// global meter (a no-op until a MeterProvider is installed). One instance,
// process-wide, so panic recovery is queryable across every service.
func recoveredPanicCounter() metric.Int64Counter {
	panicMeterOnce.Do(func() {
		panicCounter, _ = otel.Meter("langwatch-clog").Int64Counter(
			"process.goroutine.panics_recovered",
			metric.WithDescription("Recovered goroutine/root panics, tagged by goroutine name. A non-zero rate means code is panicking in the field even though the process survived — investigate."),
		)
	})
	return panicCounter
}

// LogPanic logs an already-recovered panic value with a stack trace, surfaces it
// on the active OTel span (so the panic shows up on the trace), increments the
// recovered-panic counter tagged by goroutine name, and flushes the logger.
// Exposed for callers that must recover themselves so they can act on the value
// — e.g. a process root setting a non-zero exit code — while still producing the
// full panic observability. HandlePanic delegates its logging here.
func LogPanic(ctx context.Context, v any) {
	stack := make([]byte, 1<<16)
	stack = stack[:runtime.Stack(stack, false)]

	name := GoroutineName(ctx)
	logger := Get(ctx)
	logger.Error("panic",
		zap.String("goroutine", name),
		zap.Any("panic", v),
		zap.ByteString("stack_trace", stack),
	)

	// Surface the panic on the active trace, if there is one (a per-turn / per-
	// spawn span). RecordError + Error status make recovered panics visible in
	// the trace UI, not just the logs.
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		span.RecordError(fmt.Errorf("panic: %v", v), trace.WithStackTrace(true))
		span.SetStatus(codes.Error, "panic recovered")
	}

	if c := recoveredPanicCounter(); c != nil {
		c.Add(ctx, 1, metric.WithAttributes(attribute.String("goroutine", name)))
	}

	// Sync to ensure the panic log is flushed before exit/re-panic.
	_ = logger.Sync()
}
