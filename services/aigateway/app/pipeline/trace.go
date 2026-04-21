package pipeline

import (
	"context"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/forkedcontext"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// BeginSpanFunc starts a customer trace span and returns the enriched context
// plus a W3C traceparent string representing the new span.
type BeginSpanFunc func(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string)

// EndSpanFunc ends the customer trace span, setting final attributes.
type EndSpanFunc func(ctx context.Context, params domain.AITraceParams)

// Trace creates an interceptor that brackets dispatch with customer trace spans.
func Trace(begin BeginSpanFunc, end EndSpanFunc) Interceptor {
	return Interceptor{
		Name: "traces",
		Sync: func(next DispatchFunc) DispatchFunc {
			return func(ctx context.Context, call *Call) (*domain.Response, error) {
				spanCtx, tp := begin(ctx, call.Bundle.ProjectID, call.Request.Type)
				call.Meta.CustomerTraceparent = tp

				resp, err := next(spanCtx, call)
				if err != nil {
					return nil, err
				}
				if call.Request.Resolved != nil {
					end(spanCtx, domain.AITraceParams{
						ProjectID:   call.Bundle.ProjectID,
						Model:       call.Request.Resolved.ModelID,
						ProviderID:  call.Request.Resolved.ProviderID,
						Usage:       resp.Usage,
						RequestType: call.Request.Type,
					})
				}
				return resp, nil
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				spanCtx, tp := begin(ctx, call.Bundle.ProjectID, call.Request.Type)
				call.Meta.CustomerTraceparent = tp

				iter, err := next(spanCtx, call)
				if err != nil {
					return nil, err
				}
				if call.Request.Resolved == nil {
					return iter, nil
				}
				return &traceStreamWrapper{
					inner:  iter,
					end:    end,
					bundle: call.Bundle,
					req:    call.Request,
				}, nil
			}
		},
	}
}

// traceStreamWrapper ends the customer trace span when the stream closes.
type traceStreamWrapper struct {
	inner     domain.StreamIterator
	end       EndSpanFunc
	bundle    *domain.Bundle
	req       *domain.Request
	lastCtx   context.Context
	closeOnce sync.Once
}

func (w *traceStreamWrapper) Next(ctx context.Context) bool {
	w.lastCtx = ctx
	if !w.inner.Next(ctx) {
		w.onClose()
		return false
	}
	return true
}

func (w *traceStreamWrapper) Chunk() []byte       { return w.inner.Chunk() }
func (w *traceStreamWrapper) Usage() domain.Usage { return w.inner.Usage() }
func (w *traceStreamWrapper) Err() error          { return w.inner.Err() }

func (w *traceStreamWrapper) Close() error {
	w.onClose()
	return w.inner.Close()
}

func (w *traceStreamWrapper) onClose() {
	w.closeOnce.Do(func() {
		ctx := w.lastCtx
		if ctx == nil {
			ctx = context.Background()
		}
		forkedcontext.ForkWithTimeout(ctx, 5*time.Second, func(ctx context.Context) error {
			w.end(ctx, domain.AITraceParams{
				ProjectID:   w.bundle.ProjectID,
				Model:       w.req.Resolved.ModelID,
				ProviderID:  w.req.Resolved.ProviderID,
				Usage:       w.inner.Usage(),
				RequestType: w.req.Type,
			})
			return nil
		})
	})
}
