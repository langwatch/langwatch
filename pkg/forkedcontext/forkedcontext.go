package forkedcontext

import (
	"context"
	"fmt"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
)

// forkedContext preserves context values but strips deadlines and cancellations.
type forkedContext struct {
	ctx context.Context
}

func (forkedContext) Deadline() (time.Time, bool) { return time.Time{}, false }
func (forkedContext) Done() <-chan struct{}       { return nil }
func (forkedContext) Err() error                  { return nil }
func (d forkedContext) Value(key any) any         { return d.ctx.Value(key) }

// Fork launches fn in a goroutine with a context that preserves values
// but is not canceled when the parent is. Errors are logged automatically.
func Fork(ctx context.Context, fn func(context.Context) error) {
	newCtx := forkedContext{ctx}
	go func() {
		var err error
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic: %v", r)
			}
			if err != nil {
				clog.Get(ctx).Error("forked context errored", zap.Error(err))
			}
		}()
		err = fn(newCtx)
	}()
}

// ForkWithTimeout is like Fork but adds a timeout to the forked context.
func ForkWithTimeout(ctx context.Context, timeout time.Duration, fn func(context.Context) error) {
	newCtx, cancel := context.WithTimeout(forkedContext{ctx}, timeout)
	go func() {
		var err error
		defer func() {
			cancel()
			if r := recover(); r != nil {
				err = fmt.Errorf("panic: %v", r)
			}
			if err != nil {
				clog.Get(ctx).Error("forked context errored", zap.Error(err))
			}
		}()
		err = fn(newCtx)
	}()
}
