package clog

import (
	"context"
	"runtime"

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

	stack := make([]byte, 1<<16)
	stack = stack[:runtime.Stack(stack, false)]

	logger := Get(ctx)
	logger.Error("panic",
		zap.Any("panic", v),
		zap.ByteString("stack_trace", stack),
	)

	// Sync to ensure the panic log is flushed before exit/re-panic
	_ = logger.Sync()

	if propagate {
		panic(v)
	}
}
