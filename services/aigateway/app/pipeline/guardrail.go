package pipeline

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
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
				if reason := guardrailsNotApplicable(call.Request.Type); reason != "" {
					stampGuardrailsNotApplied(call, reason)
					return next(ctx, call)
				}

				if err := call.MaterializeBody(); err != nil {
					return nil, err
				}
				verdict, err := pre(ctx, call.Bundle, call.Request)
				if blockErr := guardrailOutcome(ctx, guardrailOutcomeInput{
					direction: "request",
					verdict:   verdict,
					err:       err,
					failOpen:  call.Bundle.Config.Guardrails.RequestFailOpen,
					logger:    logger,
				}); blockErr != nil {
					return nil, blockErr
				}

				resp, err := next(ctx, call)
				if err != nil {
					return nil, err
				}

				verdict, err = post(ctx, call.Bundle, call.Request, resp)
				if blockErr := guardrailOutcome(ctx, guardrailOutcomeInput{
					direction: "response",
					verdict:   verdict,
					err:       err,
					failOpen:  call.Bundle.Config.Guardrails.ResponseFailOpen,
					logger:    logger,
				}); blockErr != nil {
					return nil, blockErr
				}
				return resp, nil
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				if !call.Bundle.Config.Guardrails.HasAny() {
					return next(ctx, call)
				}
				if reason := guardrailsNotApplicable(call.Request.Type); reason != "" {
					stampGuardrailsNotApplied(call, reason)
					return next(ctx, call)
				}

				verdict, err := pre(ctx, call.Bundle, call.Request)
				if blockErr := guardrailOutcome(ctx, guardrailOutcomeInput{
					direction: "request",
					verdict:   verdict,
					err:       err,
					failOpen:  call.Bundle.Config.Guardrails.RequestFailOpen,
					logger:    logger,
				}); blockErr != nil {
					return nil, blockErr
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

// guardrailsNotApplicable names the request types a guardrail cannot judge,
// and why, or "" for every type it can.
//
// A realtime session mint carries a session declaration, not a prompt, and
// the conversation itself never passes through the gateway. Running the
// key's guardrails against that body would pass a check on content nobody
// spoke yet and report protection over a socket the gateway cannot see. The
// caller is told so on the response, because a silently skipped guardrail is
// the failure that looks exactly like a working one.
func guardrailsNotApplicable(t domain.RequestType) string {
	if t == domain.RequestTypeRealtimeSession {
		return "realtime_session"
	}
	return ""
}

// stampGuardrailsNotApplied records the skip for the response header.
func stampGuardrailsNotApplied(call *Call, reason string) {
	call.Meta.Update(func(m *Meta) { m.GuardrailsNotApplied = reason })
}

type guardrailOutcomeInput struct {
	direction string
	verdict   domain.GuardrailVerdict
	err       error
	failOpen  bool
	logger    *zap.Logger
}

// guardrailOutcome turns a guardrail evaluation into either nil (proceed) or the
// error that stops the request.
//
// An evaluation that could not complete is not the same as one that passed.
// Guardrails default to fail-closed so that a control plane outage or a wire
// mismatch cannot quietly disable a protection the operator switched on. A
// virtual key opts into fail-open per direction when availability matters more
// than enforcement. Stream chunks are the deliberate exception and always fail
// open, so a slow policy service never stalls a user's stream.
func guardrailOutcome(ctx context.Context, in guardrailOutcomeInput) error {
	if in.err != nil {
		if in.failOpen {
			in.logger.Warn("guardrail_fail_open",
				zap.String("direction", in.direction), zap.Error(in.err))
			recordGuardrailDegradation(ctx, in.direction, in.err)
			return nil
		}
		in.logger.Error("guardrail_fail_closed",
			zap.String("direction", in.direction), zap.Error(in.err))
		// The client gets a fixed message. The underlying error names the
		// control plane host and its failure detail, which belongs in the log
		// and the span, not in a response body an API caller can read.
		return herr.New(ctx, domain.ErrGuardrailUpstreamUnavailable, herr.M{
			"message": "guardrail could not be evaluated",
		}, in.err)
	}
	if in.verdict.Action == domain.GuardrailBlock {
		return herr.New(ctx, domain.ErrGuardrailBlocked, herr.M{"message": in.verdict.Message})
	}
	return nil
}

// recordGuardrailDegradation stamps a fail-open bypass onto the active span.
// A key that opted into fail-open trades enforcement for availability, and the
// operator has to be able to see when that trade actually fired. A log line
// alone is not enough: the request that skipped its guardrail is the one being
// traced.
func recordGuardrailDegradation(ctx context.Context, direction string, cause error) {
	span := trace.SpanFromContext(ctx)
	if !span.SpanContext().IsValid() {
		return
	}
	span.SetAttributes(
		attribute.Bool("langwatch.guardrail.fail_open", true),
		attribute.String("langwatch.guardrail.direction", direction),
	)
	span.AddEvent("guardrail_fail_open", trace.WithAttributes(
		attribute.String("langwatch.guardrail.direction", direction),
		attribute.String("langwatch.guardrail.cause", cause.Error()),
	))
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

// RawFraming delegates to the inner iterator so writers can still
// detect raw-framed (Gemini passthrough) streams through wrapper chains.
func (w *guardrailStreamWrapper) RawFraming() bool {
	if rf, ok := w.inner.(domain.RawFramer); ok {
		return rf.RawFraming()
	}
	return false
}
