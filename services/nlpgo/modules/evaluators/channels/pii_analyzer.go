package channels

import (
	"context"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// PIIAnalyzer finds the PII patterns cannot, such as PERSON and LOCATION
// (plan §9). It is configured by the operator, never by a tenant; with none
// configured the channel is nil.
type PIIAnalyzer interface {
	Covers() []contract.EntityType
	Analyze(ctx context.Context, req AnalyzeRequest) (AnalyzeResult, error)
}

// AnalyzeRequest is one text to analyze. Text is tenant content: it never
// reaches a log, a span or an error message.
type AnalyzeRequest struct {
	ProjectID string
	Text      string
	Entities  []contract.EntityType
	Language  string
}

// AnalyzeResult holds the analyzer's findings, scored on Presidio's scale.
type AnalyzeResult struct {
	Findings []contract.PIIFinding // {EntityType, Start, End, Score}
}
