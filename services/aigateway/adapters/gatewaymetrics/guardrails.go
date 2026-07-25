package gatewaymetrics

import (
	"context"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Directions a guardrail can be evaluated in.
const (
	DirectionRequest     = "request"
	DirectionResponse    = "response"
	DirectionStreamChunk = "stream_chunk"
)

// guardrailEvaluator is redeclared here, rather than imported from the app
// layer, so this adapter stays free of an app dependency. It mirrors
// app.GuardrailEvaluator.
type guardrailEvaluator interface {
	EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error)
	EvaluatePost(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error)
	EvaluateChunk(ctx context.Context, bundle *domain.Bundle, req *domain.Request, chunk []byte) (domain.GuardrailVerdict, error)
}

// GuardrailCounter decorates a guardrail evaluator with verdict counting,
// following the same wrap-the-port pattern as gatewaytracer's stamping
// emitter. The counting sits outside the evaluator so the decision logic
// stays untouched.
//
// An evaluation the gateway could not complete is counted as fail_open
// rather than as an allow: the caller's traffic did pass, but it passed
// unchecked, and an operator has to be able to tell those apart. Note that
// the stream-chunk path fails open inside the control-plane client, which
// returns a plain allow, so fail_open is only observable here for the
// request and response directions.
type GuardrailCounter struct {
	inner    guardrailEvaluator
	recorder *Recorder
}

// WithGuardrailMetrics wraps an evaluator so every verdict is counted.
func WithGuardrailMetrics(inner guardrailEvaluator, recorder *Recorder) GuardrailCounter {
	return GuardrailCounter{inner: inner, recorder: recorder}
}

func (g GuardrailCounter) EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error) {
	verdict, err := g.inner.EvaluatePre(ctx, bundle, req)
	g.record(DirectionRequest, verdict, err)
	return verdict, err
}

func (g GuardrailCounter) EvaluatePost(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error) {
	verdict, err := g.inner.EvaluatePost(ctx, bundle, req, resp)
	g.record(DirectionResponse, verdict, err)
	return verdict, err
}

func (g GuardrailCounter) EvaluateChunk(ctx context.Context, bundle *domain.Bundle, req *domain.Request, chunk []byte) (domain.GuardrailVerdict, error) {
	verdict, err := g.inner.EvaluateChunk(ctx, bundle, req, chunk)
	g.record(DirectionStreamChunk, verdict, err)
	return verdict, err
}

func (g GuardrailCounter) record(direction string, verdict domain.GuardrailVerdict, err error) {
	if err != nil {
		g.recorder.RecordGuardrailVerdict(direction, VerdictFailOpen)
		return
	}
	g.recorder.RecordGuardrailVerdict(direction, VerdictLabel(verdict.Action))
}
