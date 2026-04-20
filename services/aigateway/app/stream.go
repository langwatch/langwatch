package app

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/pkg/forkedcontext"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// guardedStreamIterator wraps a stream with chunk-level guardrails,
// usage accumulation, and post-stream debit/trace emission.
type guardedStreamIterator struct {
	inner     domain.StreamIterator
	app       *App
	bundle    *domain.Bundle
	req       *domain.Request
	startTime time.Time
	usage     domain.Usage
	closed    bool
	lastCtx   context.Context // last ctx from Next, used in onClose
}

func newGuardedStream(inner domain.StreamIterator, a *App, bundle *domain.Bundle, req *domain.Request) *guardedStreamIterator {
	return &guardedStreamIterator{
		inner:     inner,
		app:       a,
		bundle:    bundle,
		req:       req,
		startTime: time.Now(),
	}
}

func (g *guardedStreamIterator) Next(ctx context.Context) bool {
	g.lastCtx = ctx
	if g.closed {
		return false
	}
	if !g.inner.Next(ctx) {
		g.closed = true
		g.onClose()
		return false
	}

	// Chunk-level guardrail (fail-open on error/timeout)
	if g.app.guardrails != nil && len(g.bundle.Config.Guardrails) > 0 {
		verdict, err := g.app.guardrails.EvaluateChunk(ctx, g.bundle, g.req, g.inner.Chunk())
		if err == nil && verdict.Action == GuardrailBlock {
			g.closed = true
			g.onClose()
			return false
		}
	}

	// Accumulate latest usage
	if u := g.inner.Usage(); u.TotalTokens > 0 {
		g.usage = u
	}

	return true
}

func (g *guardedStreamIterator) Chunk() []byte       { return g.inner.Chunk() }
func (g *guardedStreamIterator) Usage() domain.Usage  { return g.usage }
func (g *guardedStreamIterator) Err() error           { return g.inner.Err() }
func (g *guardedStreamIterator) Close() error         { return g.inner.Close() }

func (g *guardedStreamIterator) onClose() {
	ctx := g.lastCtx
	if ctx == nil {
		ctx = context.Background()
	}

	// Fork so debit + trace survive client disconnect (the request context
	// may already be cancelled if the client hung up mid-stream).
	duration := time.Since(g.startTime)
	forkedcontext.ForkWithTimeout(ctx, 5*time.Second, func(ctx context.Context) error {
		if g.app.budget != nil {
			g.app.budget.Debit(ctx, g.bundle, g.usage)
		}
		if g.app.traces != nil && g.req.Resolved != nil {
			g.app.traces.Emit(ctx, AITraceParams{
				ProjectID:   g.bundle.ProjectID,
				Model:       g.req.Resolved.ModelID,
				ProviderID:  g.req.Resolved.ProviderID,
				Usage:       g.usage,
				DurationMS:  duration.Milliseconds(),
				Streaming:   true,
				RequestType: g.req.Type,
			})
		}
		return nil
	})
}
