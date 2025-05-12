package langwatch

import (
	"encoding/json"
	"log"

	"go.opentelemetry.io/otel/trace"

	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

type SpanType string
type typeWrapperType string

const (
	SpanTypeSpan       SpanType = "span"
	SpanTypeLLM        SpanType = "llm"
	SpanTypeChain      SpanType = "chain"
	SpanTypeTool       SpanType = "tool"
	SpanTypeAgent      SpanType = "agent"
	SpanTypeGuardrail  SpanType = "guardrail"
	SpanTypeEvaluation SpanType = "evaluation"
	SpanTypeRAG        SpanType = "rag"
	SpanTypeWorkflow   SpanType = "workflow"
	SpanTypeComponent  SpanType = "component"
	SpanTypeModule     SpanType = "module"
	SpanTypeServer     SpanType = "server"
	SpanTypeClient     SpanType = "client"
	SpanTypeProducer   SpanType = "producer"
	SpanTypeConsumer   SpanType = "consumer"
	SpanTypeTask       SpanType = "task"
	SpanTypeUnknown    SpanType = "unknown"

	typeWrapperTypeJSON typeWrapperType = "json"
	typeWrapperTypeText typeWrapperType = "text"
)

type SpanTimestamps struct {
	StartedAtUnix    int64  `json:"started_at"`
	FirstTokenAtUnix *int64 `json:"first_token_at"`
	FinishedAtUnix   int64  `json:"finished_at"`
}

type SpanRAGContextChunk struct {
	DocumentID string `json:"document_id"`
	ChunkID    string `json:"chunk_id"`
	Content    any    `json:"content"`
}

type typeWrapper struct {
	Type  typeWrapperType `json:"type"`
	Value any             `json:"value"`
}

type Span struct {
	trace.Span
}

func (s *Span) RecordInput(input any) {
	jsonStr, err := json.Marshal(typeWrapper{
		Type:  typeWrapperTypeJSON,
		Value: input,
	})
	if err != nil {
		log.Default().Printf("error marshalling input: %v", err)
	}

	s.SetAttributes(AttributeLangWatchInput.String(string(jsonStr)))
}

func (s *Span) RecordInputString(input string) {
	jsonStr, err := json.Marshal(typeWrapper{
		Type:  typeWrapperTypeText,
		Value: input,
	})
	if err != nil {
		log.Default().Printf("error marshalling input: %v", err)
	}

	s.SetAttributes(AttributeLangWatchInput.String(string(jsonStr)))
}

func (s *Span) RecordOutput(output any) {
	jsonStr, err := json.Marshal(typeWrapper{
		Type:  typeWrapperTypeJSON,
		Value: output,
	})
	if err != nil {
		log.Default().Printf("error marshalling output: %v", err)
	}

	s.SetAttributes(AttributeLangWatchOutput.String(string(jsonStr)))
}

func (s *Span) RecordOutputString(output string) {
	jsonStr, err := json.Marshal(typeWrapper{
		Type:  typeWrapperTypeText,
		Value: output,
	})
	if err != nil {
		log.Default().Printf("error marshalling output: %v", err)
	}

	s.SetAttributes(AttributeLangWatchOutput.String(string(jsonStr)))
}

func (s *Span) SetType(spanType SpanType) {
	s.SetAttributes(AttributeLangWatchSpanType.String(string(spanType)))
}

func (s *Span) SetRequestModel(model string) {
	s.SetAttributes(semconv.GenAiRequestModelKey.String(model))
}

func (s *Span) SetResponseModel(model string) {
	s.SetAttributes(semconv.GenAiResponseModelKey.String(model))
}

func (s *Span) SetTimestamps(timestamps SpanTimestamps) {
	jsonStr, err := json.Marshal(typeWrapper{
		Type:  typeWrapperTypeJSON,
		Value: timestamps,
	})
	if err != nil {
		log.Default().Printf("error marshalling timestamps: %v", err)
	}

	s.SetAttributes(AttributeLangWatchTimestamps.String(string(jsonStr)))
}

func (s *Span) SetRAGContextChunks(contexts []SpanRAGContextChunk) {
	jsonStr, err := json.Marshal(typeWrapper{
		Type:  typeWrapperTypeJSON,
		Value: contexts,
	})
	if err != nil {
		log.Default().Printf("error marshalling contexts: %v", err)
	}

	s.SetAttributes(AttributeLangWatchRAGContexts.String(string(jsonStr)))
}

func (s *Span) SetRAGContextChunk(context SpanRAGContextChunk) {
	s.SetRAGContextChunks([]SpanRAGContextChunk{context})
}
