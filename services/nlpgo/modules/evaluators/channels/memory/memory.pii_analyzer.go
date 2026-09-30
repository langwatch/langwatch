package memory

import (
	"context"
	"slices"
	"sync"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// PIIAnalyzer is the PIIAnalyzer twin: it covers what it is built with,
// answers with its script and records every request.
type PIIAnalyzer struct {
	covers []contract.EntityType

	mu       sync.Mutex
	analyze  func(context.Context, channels.AnalyzeRequest) (channels.AnalyzeResult, error)
	requests []channels.AnalyzeRequest
}

var _ channels.PIIAnalyzer = (*PIIAnalyzer)(nil)

// NewPIIAnalyzer returns a twin covering the given entities, finding nothing.
func NewPIIAnalyzer(covers ...contract.EntityType) *PIIAnalyzer {
	return &PIIAnalyzer{covers: covers}
}

// Script sets how Analyze answers.
func (a *PIIAnalyzer) Script(fn func(context.Context, channels.AnalyzeRequest) (channels.AnalyzeResult, error)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.analyze = fn
}

// Covers are the entities the twin was built with.
func (a *PIIAnalyzer) Covers() []contract.EntityType { return slices.Clone(a.covers) }

// Analyze records the request and answers with the script, or nothing.
func (a *PIIAnalyzer) Analyze(ctx context.Context, req channels.AnalyzeRequest) (channels.AnalyzeResult, error) {
	a.mu.Lock()
	a.requests = append(a.requests, req)
	analyze := a.analyze
	a.mu.Unlock()
	if analyze == nil {
		return channels.AnalyzeResult{}, nil
	}
	return analyze(ctx, req)
}

// Requests are the requests received so far.
func (a *PIIAnalyzer) Requests() []channels.AnalyzeRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.requests)
}
