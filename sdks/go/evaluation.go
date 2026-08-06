package langwatch

import (
	"encoding/json"
	"log"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// EvaluationError captures a failed evaluation, matching the server's error shape.
type EvaluationError struct {
	HasError   bool     `json:"has_error"`
	Message    string   `json:"message"`
	Stacktrace []string `json:"stacktrace,omitempty"`
}

// EvaluationTimestamps records when an evaluation ran, in unix epoch milliseconds.
type EvaluationTimestamps struct {
	StartedAt  *int64 `json:"started_at,omitempty"`
	FinishedAt *int64 `json:"finished_at,omitempty"`
}

// Evaluation is the result of an evaluation or guardrail attached to a span via
// RecordEvaluation. Only Name is required; Status defaults to "processed". The
// field shape matches the LangWatch REST evaluation schema, so the same value
// can also be submitted by trace id through the client SDK.
type Evaluation struct {
	EvaluationID string                `json:"evaluation_id,omitempty"`
	Name         string                `json:"name"`
	Type         string                `json:"type,omitempty"`
	IsGuardrail  *bool                 `json:"is_guardrail,omitempty"`
	Status       EvaluationStatus      `json:"status,omitempty"`
	Passed       *bool                 `json:"passed,omitempty"`
	Score        *float64              `json:"score,omitempty"`
	Label        string                `json:"label,omitempty"`
	Details      string                `json:"details,omitempty"`
	Cost         *Money                `json:"cost,omitempty"`
	Error        *EvaluationError      `json:"error,omitempty"`
	Timestamps   *EvaluationTimestamps `json:"timestamps,omitempty"`
}

// RecordEvaluation attaches an evaluation result to the span as a
// langwatch.evaluation.custom span event — the mechanism the server reads to
// sync evaluations to a trace. Status defaults to "processed" when unset.
//
//	span.RecordEvaluation(langwatch.Evaluation{
//	    Name:   "answer relevancy",
//	    Passed: langwatch.Bool(true),
//	    Score:  langwatch.Float64(0.92),
//	})
func (s *Span) RecordEvaluation(eval Evaluation) *Span {
	if eval.Status == "" {
		eval.Status = EvaluationStatusProcessed
	}
	payload, err := json.Marshal(eval)
	if err != nil {
		log.Default().Printf("langwatch: error marshalling evaluation: %v", err)
		return s
	}
	s.AddEvent(string(AttributeLangWatchEvaluationCustom), trace.WithAttributes(
		attribute.String("json_encoded_event", string(payload)),
	))
	return s
}
