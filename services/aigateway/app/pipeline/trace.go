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
						ProjectID:        call.Bundle.ProjectID,
						Model:            call.Request.Resolved.ModelID,
						ProviderID:       call.Request.Resolved.ProviderID,
						Usage:            resp.Usage,
						RequestType:      call.Request.Type,
						VirtualKeyID:     call.Bundle.VirtualKeyID,
						GatewayRequestID: call.Meta.GatewayRequestID,
						RequestBody:      call.Request.Body,
						ResponseBody:     resp.Body,
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
					inner:   iter,
					end:     end,
					bundle:  call.Bundle,
					req:     call.Request,
					meta:    call.Meta,
					spanCtx: spanCtx,
				}, nil
			}
		},
	}
}

// responseBodyCap bounds the per-stream response accumulator at 8 MiB so a
// runaway upstream cannot OOM the gateway. Once the cap is hit further
// chunks are dropped from the trace body (the upstream client still sees
// them — we don't gate on this). 8 MiB fits the longest realistic LLM
// response we've measured (claude-opus-4-7 with full reasoning at ~6 MiB)
// with headroom; anything past that is almost always pathological.
const responseBodyCap = 8 * 1024 * 1024

// traceStreamWrapper ends the customer trace span when the stream closes
// and accumulates response chunks so the emitter can lift the assistant
// output text out of the streamed SSE body. Without this accumulator the
// onClose path was passing nil ResponseBody to AITraceParams, which made
// extractOutputMessages return "" for every streamed Path A trace — the
// gen_ai.output.messages key was simply absent from every streaming span.
type traceStreamWrapper struct {
	inner       domain.StreamIterator
	end         EndSpanFunc
	bundle      *domain.Bundle
	req         *domain.Request
	meta        *Meta
	spanCtx     context.Context
	closeOnce   sync.Once
	bodyMu      sync.Mutex
	body        []byte
	bodyDropped bool
}

func (w *traceStreamWrapper) Next(ctx context.Context) bool {
	if !w.inner.Next(ctx) {
		w.onClose()
		return false
	}
	w.captureChunk(w.inner.Chunk())
	return true
}

func (w *traceStreamWrapper) Chunk() []byte       { return w.inner.Chunk() }
func (w *traceStreamWrapper) Usage() domain.Usage { return w.inner.Usage() }
func (w *traceStreamWrapper) Err() error          { return w.inner.Err() }

// captureChunk appends chunk to the body accumulator under the cap.
// Called from Next() after the inner iterator advances, so we capture
// exactly once per chunk regardless of how many times the caller reads
// Chunk(). bodyDropped flips once we've truncated so onClose can stamp
// a langwatch.reserved.trace_body_truncated marker downstream.
func (w *traceStreamWrapper) captureChunk(chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	w.bodyMu.Lock()
	defer w.bodyMu.Unlock()
	if w.bodyDropped {
		return
	}
	remaining := responseBodyCap - len(w.body)
	if remaining <= 0 {
		w.bodyDropped = true
		return
	}
	if len(chunk) > remaining {
		w.body = append(w.body, chunk[:remaining]...)
		w.bodyDropped = true
		return
	}
	w.body = append(w.body, chunk...)
}

// RawFraming delegates to the inner iterator so writers can still
// detect raw-framed (Gemini passthrough) streams through wrapper chains.
func (w *traceStreamWrapper) RawFraming() bool {
	if rf, ok := w.inner.(domain.RawFramer); ok {
		return rf.RawFraming()
	}
	return false
}

func (w *traceStreamWrapper) Close() error {
	w.onClose()
	return w.inner.Close()
}

func (w *traceStreamWrapper) onClose() {
	w.closeOnce.Do(func() {
		w.bodyMu.Lock()
		body := w.body
		w.bodyMu.Unlock()
		// Use spanCtx (not the caller's Next ctx) because the active span is
		// stored there by BeginSpan — the transport's request context doesn't
		// carry it.
		forkedcontext.ForkWithTimeout(w.spanCtx, 5*time.Second, func(ctx context.Context) error {
			w.end(ctx, domain.AITraceParams{
				ProjectID:        w.bundle.ProjectID,
				Model:            w.req.Resolved.ModelID,
				ProviderID:       w.req.Resolved.ProviderID,
				Usage:            w.inner.Usage(),
				RequestType:      w.req.Type,
				VirtualKeyID:     w.bundle.VirtualKeyID,
				GatewayRequestID: w.meta.GatewayRequestID,
				RequestBody:      w.req.Body,
				ResponseBody:     body,
			})
			return nil
		})
	})
}
