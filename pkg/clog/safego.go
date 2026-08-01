package clog

import (
	"context"

	"go.uber.org/zap"
)

// Go runs fn on a new goroutine with panic recovery. A panic inside fn is
// recovered and logged with a stack trace via HandlePanic (which does NOT
// re-panic), so a crashing background goroutine can never take the whole
// process down with it. Use this instead of a bare `go fn()` anywhere a panic
// would otherwise be an unrecovered, fatal goroutine crash.
//
// name is a human label for the goroutine; it is stamped onto the recovery log
// so a recovered panic can be traced back to its launch site.
//
//	clog.Go(ctx, "worker-exit-watcher", func() { ... })
func Go(ctx context.Context, name string, fn func()) {
	ctx = With(ctx, zap.String("goroutine", name))
	ctx = context.WithValue(ctx, goroutineNameKey{}, name)
	go func() {
		defer HandlePanic(ctx, false)
		fn()
	}()
}

type goroutineNameKey struct{}

// GoroutineName returns the clog.Go label stored in ctx, or "unnamed" when the
// context did not originate from clog.Go. Used to tag panic observability so a
// recovered panic is attributable to its launch site.
func GoroutineName(ctx context.Context) string {
	if name, ok := ctx.Value(goroutineNameKey{}).(string); ok && name != "" {
		return name
	}
	return "unnamed"
}

// PER-ITERATION LOOP RECOVERY
//
// A long-lived sweeper loop (idle reaper, zombie reaper) must NOT be wrapped in
// a single whole-goroutine recover: if one bad iteration panics, the recover
// fires once and the loop is gone forever — idle workers stop being reaped, the
// process table leaks, and nothing logs after the first incident. The correct
// shape is a recover INSIDE the loop body so a panic in one iteration is logged
// and the NEXT iteration still runs. Wrap the per-iteration work in a closure
// whose deferred HandlePanic scopes recovery to that one turn:
//
//	for {
//		select {
//		case <-ctx.Done():
//			return
//		case <-tick.C:
//			func() {
//				defer clog.HandlePanic(ctx, false)
//				doOneSweep()
//			}()
//		}
//	}
