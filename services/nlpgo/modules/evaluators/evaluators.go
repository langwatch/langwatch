// Package evaluators is the Go evaluator runtime that replaces langevals.
// Plan: dev/docs/plans/langevals-go-replacement.md.
package evaluators

import (
	"context"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

// Deps are built channels and the module's own ops tracer, never raw
// clients. OpsTracer must not be nlpgo's multi-tenant provider (plan §6.2).
type Deps struct {
	Config        contract.Config
	LLM           channels.LLMChannel
	CustomerTrace channels.CustomerTraceChannel
	OpsTracer     trace.Tracer
	Logger        *zap.Logger
}

// Module serves contract.EvaluatorRuntimeAPI.
type Module struct {
	evaluation *services.EvaluationService
}

var _ contract.EvaluatorRuntimeAPI = (*Module)(nil)

// New builds the module.
func New(deps Deps) *Module {
	return &Module{evaluation: services.NewEvaluationService(services.EvaluationDeps{
		Config:        deps.Config,
		LLM:           deps.LLM,
		CustomerTrace: deps.CustomerTrace,
		OpsTracer:     deps.OpsTracer,
		Logger:        deps.Logger,
	})}
}

// Evaluate runs one evaluator over a batch of entries.
func (m *Module) Evaluate(ctx context.Context, req contract.EvaluateRequest) ([]contract.Result, error) {
	return m.evaluation.Evaluate(ctx, req)
}
