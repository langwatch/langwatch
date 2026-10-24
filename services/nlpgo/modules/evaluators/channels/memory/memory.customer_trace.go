package memory

import (
	"context"
	"sync"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
)

// CustomerTrace is the CustomerTraceChannel twin. It records what would be
// exported; FailExports makes every span end panic as a broken exporter.
type CustomerTrace struct {
	mu          sync.Mutex
	failExports bool
	evaluations []channels.EvaluationSpan
	outcomes    []channels.EvaluationOutcome
	calls       []channels.CallSpan
	callEnds    []channels.CallOutcome
}

var _ channels.CustomerTraceChannel = (*CustomerTrace)(nil)

// NewCustomerTrace returns a twin that records every span.
func NewCustomerTrace() *CustomerTrace { return &CustomerTrace{} }

// FailExports scripts every span end to fail.
func (c *CustomerTrace) FailExports() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failExports = true
}

// StartEvaluation records the evaluation span.
func (c *CustomerTrace) StartEvaluation(ctx context.Context, ev channels.EvaluationSpan) (context.Context, func(channels.EvaluationOutcome)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.evaluations = append(c.evaluations, ev)
	return ctx, func(outcome channels.EvaluationOutcome) {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.failExports {
			panic("memory.CustomerTrace: evaluation span export failed")
		}
		c.outcomes = append(c.outcomes, outcome)
	}
}

// StartCall records the call span.
func (c *CustomerTrace) StartCall(_ context.Context, call channels.CallSpan) func(channels.CallOutcome) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls = append(c.calls, call)
	return func(outcome channels.CallOutcome) {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.failExports {
			panic("memory.CustomerTrace: call span export failed")
		}
		c.callEnds = append(c.callEnds, outcome)
	}
}

// Evaluations returns a copy of every evaluation span started.
func (c *CustomerTrace) Evaluations() []channels.EvaluationSpan {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]channels.EvaluationSpan(nil), c.evaluations...)
}

// Outcomes returns a copy of every evaluation span ended.
func (c *CustomerTrace) Outcomes() []channels.EvaluationOutcome {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]channels.EvaluationOutcome(nil), c.outcomes...)
}

// CallEnds returns a copy of every call span ended.
func (c *CustomerTrace) CallEnds() []channels.CallOutcome {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]channels.CallOutcome(nil), c.callEnds...)
}
