package client

import (
	"context"
	"fmt"
	"net/http"

	langwatch "github.com/langwatch/langwatch/sdks/go"
)

// EvaluationsService submits evaluation results against an already-ingested
// trace, addressed by trace id.
//
// Access it via [Client.Evaluations]. It is the by-trace-id counterpart to the
// core SDK's live span.RecordEvaluation: the very same [langwatch.Evaluation]
// value a developer records on a span while tracing can be handed to
// [EvaluationsService.Create] afterwards. Capture the id from the span —
// span.SpanContext().TraceID().String() — and submit later when an
// out-of-band evaluator (an LLM judge, a human review job, a nightly batch)
// produces its verdict.
type EvaluationsService struct {
	client *Client
}

// Evaluation is re-exported from the core module so callers depend only on this
// package while still passing the exact type span.RecordEvaluation accepts. The
// JSON field shape matches the LangWatch ingestion schema, so a value built once
// works in both places.
type Evaluation = langwatch.Evaluation

// collectorEvaluationPath is the LangWatch REST ingestion (collector) endpoint.
// It is not part of the published OpenAPI specification — and so has no generated
// client method — but it is the only REST surface that attaches an evaluation to
// an existing trace by id. Submissions go through [Client.rawJSON] so they share
// the SDK's auth, headers and retry behaviour.
const collectorEvaluationPath = "/api/collector"

// collectorEvaluationRequest is the minimal POST /api/collector body needed to
// attach evaluations to a trace. The endpoint keys evaluations off TraceID and
// requires a Spans array, which is sent empty here because this is an
// evaluation-only submission against a trace that already has its spans. The
// Evaluations entries serialise with the core langwatch.Evaluation JSON tags,
// which the collector's REST evaluation schema accepts field-for-field.
type collectorEvaluationRequest struct {
	TraceID     string                 `json:"trace_id"`
	Spans       []any                  `json:"spans"`
	Evaluations []langwatch.Evaluation `json:"evaluations"`
}

// Create submits a single evaluation result against an existing trace, by trace
// id. The eval is the same [langwatch.Evaluation] (aliased here as [Evaluation])
// accepted by span.RecordEvaluation, so a value can be recorded live or submitted
// later through this method interchangeably. Name is required; Status defaults to
// "processed" when unset, matching the live path.
//
//	traceID := span.SpanContext().TraceID().String()
//	// ... later, once an evaluator scores the trace ...
//	err := lw.Evaluations.Create(ctx, traceID, client.Evaluation{
//		Name:   "answer relevancy",
//		Passed: langwatch.Bool(true),
//		Score:  langwatch.Float64(0.92),
//	})
//
// It maps to the LangWatch REST collector endpoint (POST /api/collector). There
// is deliberately no dedicated public "submit evaluation by trace id" REST route;
// the collector is the supported ingestion path the SDKs share, and it dispatches
// the evaluation into the same pipeline as a live span event.
func (s *EvaluationsService) Create(ctx context.Context, traceID string, eval Evaluation) error {
	return s.create(ctx, "Evaluations.Create", traceID, []Evaluation{eval})
}

// CreateBatch submits several evaluation results against one trace in a single
// request — handy when an evaluator produces a panel of scores. It shares the
// endpoint and semantics of [EvaluationsService.Create]; each evaluation's Status
// defaults to "processed" when unset.
//
//	err := lw.Evaluations.CreateBatch(ctx, traceID, []client.Evaluation{
//		{Name: "relevancy", Score: langwatch.Float64(0.92), Passed: langwatch.Bool(true)},
//		{Name: "toxicity", Score: langwatch.Float64(0.01), Passed: langwatch.Bool(true)},
//	})
func (s *EvaluationsService) CreateBatch(ctx context.Context, traceID string, evals []Evaluation) error {
	return s.create(ctx, "Evaluations.CreateBatch", traceID, evals)
}

// create is the shared implementation behind [EvaluationsService.Create] and
// [EvaluationsService.CreateBatch]. The operation name is passed down rather
// than hard-coded so a validation error and an [*APIError].Operation always name
// the method the caller actually invoked — Operation is part of the public error
// surface, so it must match the entry point.
func (s *EvaluationsService) create(ctx context.Context, operation, traceID string, evals []Evaluation) error {
	if traceID == "" {
		return fmt.Errorf("langwatch: %s: traceID is required", operation)
	}
	if len(evals) == 0 {
		return fmt.Errorf("langwatch: %s: at least one evaluation is required", operation)
	}

	body := collectorEvaluationRequest{
		TraceID:     traceID,
		Spans:       []any{},
		Evaluations: make([]langwatch.Evaluation, len(evals)),
	}
	for i, e := range evals {
		if e.Status == "" {
			e.Status = langwatch.EvaluationStatusProcessed
		}
		body.Evaluations[i] = e
	}

	resp, err := s.client.rawJSON(ctx, http.MethodPost, collectorEvaluationPath, body)
	return decodeInto(operation, resp, err, nil)
}
