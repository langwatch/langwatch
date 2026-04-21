package pipeline

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// GuardrailPreFunc evaluates guardrails before dispatch.
type GuardrailPreFunc func(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error)

// GuardrailPostFunc evaluates guardrails after a sync response.
type GuardrailPostFunc func(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error)

// GuardrailChunkFunc evaluates guardrails on a single stream chunk.
type GuardrailChunkFunc func(ctx context.Context, bundle *domain.Bundle, req *domain.Request, chunk []byte) (domain.GuardrailVerdict, error)

// Guardrail creates an interceptor that evaluates pre/post guardrails and
// wraps streams with chunk-level evaluation.
func Guardrail(pre GuardrailPreFunc, post GuardrailPostFunc, chunk GuardrailChunkFunc, logger *zap.Logger) Interceptor {
	return Interceptor{
		Name: "guardrails",
		Sync: func(next DispatchFunc) DispatchFunc {
			return func(ctx context.Context, call *Call) (*domain.Response, error) {
				if !call.Bundle.Config.Guardrails.HasAny() {
					return next(ctx, call)
				}

				if err := call.MaterializeBody(); err != nil {
					return nil, err
				}
				verdict, err := pre(ctx, call.Bundle, call.Request)
				if err != nil {
					logger.Warn("guardrail_pre_error", zap.Error(err))
				} else if verdict.Action == domain.GuardrailBlock {
					return nil, herr.New(ctx, domain.ErrGuardrailBlocked, herr.M{"message": verdict.Message})
				}

				resp, err := next(ctx, call)
				if err != nil {
					return nil, err
				}

				verdict, err = post(ctx, call.Bundle, call.Request, resp)
				if err != nil {
					logger.Warn("guardrail_post_error", zap.Error(err))
				} else if verdict.Action == domain.GuardrailBlock {
					return nil, herr.New(ctx, domain.ErrGuardrailBlocked, herr.M{"message": verdict.Message})
				}
				return resp, nil
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				if !call.Bundle.Config.Guardrails.HasAny() {
					return next(ctx, call)
				}

				verdict, err := pre(ctx, call.Bundle, call.Request)
				if err != nil {
					logger.Warn("guardrail_pre_error", zap.Error(err))
				} else if verdict.Action == domain.GuardrailBlock {
					return nil, herr.New(ctx, domain.ErrGuardrailBlocked, herr.M{"message": verdict.Message})
				}

				iter, err := next(ctx, call)
				if err != nil {
					return nil, err
				}
				return &guardrailStreamWrapper{
					inner:  iter,
					chunk:  chunk,
					bundle: call.Bundle,
					req:    call.Request,
				}, nil
			}
		},
	}
}

// guardrailStreamWrapper evaluates chunk-level guardrails on each chunk.
type guardrailStreamWrapper struct {
	inner   domain.StreamIterator
	chunk   GuardrailChunkFunc
	bundle  *domain.Bundle
	req     *domain.Request
	blocked bool
}

func (w *guardrailStreamWrapper) Next(ctx context.Context) bool {
	if w.blocked {
		return false
	}
	if !w.inner.Next(ctx) {
		return false
	}
	verdict, err := w.chunk(ctx, w.bundle, w.req, w.inner.Chunk())
	if err == nil && verdict.Action == domain.GuardrailBlock {
		w.blocked = true
		_ = w.inner.Close()
		return false
	}
	return true
}

func (w *guardrailStreamWrapper) Chunk() []byte       { return w.inner.Chunk() }
func (w *guardrailStreamWrapper) Usage() domain.Usage { return w.inner.Usage() }
func (w *guardrailStreamWrapper) Err() error          { return w.inner.Err() }
func (w *guardrailStreamWrapper) Close() error        { return w.inner.Close() }
