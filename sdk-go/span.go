package langwatch

import (
	"encoding/json"
	"log"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// SpanType categorises a span for downstream analysis and visualisation. It is
// recorded under langwatch.span.type.
type SpanType string

const (
	SpanTypeSpan       SpanType = "span"
	SpanTypeLLM        SpanType = "llm"
	SpanTypeChain      SpanType = "chain"
	SpanTypeTool       SpanType = "tool"
	SpanTypeAgent      SpanType = "agent"
	SpanTypeGuardrail  SpanType = "guardrail"
	SpanTypeEvaluation SpanType = "evaluation"
	SpanTypeRAG        SpanType = "rag"
	SpanTypePrompt     SpanType = "prompt"
	SpanTypeWorkflow   SpanType = "workflow"
	SpanTypeComponent  SpanType = "component"
	SpanTypeModule     SpanType = "module"
	SpanTypeServer     SpanType = "server"
	SpanTypeClient     SpanType = "client"
	SpanTypeProducer   SpanType = "producer"
	SpanTypeConsumer   SpanType = "consumer"
	SpanTypeTask       SpanType = "task"
	SpanTypeUnknown    SpanType = "unknown"
)

// SpanTimestamps carries SDK-measured span timing in unix epoch milliseconds.
// Recorded as a bare JSON object under langwatch.timestamps.
type SpanTimestamps struct {
	StartedAtUnix    int64  `json:"started_at"`
	FirstTokenAtUnix *int64 `json:"first_token_at,omitempty"`
	FinishedAtUnix   int64  `json:"finished_at"`
}

// SpanRAGContextChunk is a single retrieved chunk used as generation context.
// Recorded as an element of the bare JSON array under langwatch.rag.contexts.
type SpanRAGContextChunk struct {
	DocumentID string `json:"document_id,omitempty"`
	ChunkID    string `json:"chunk_id,omitempty"`
	Content    any    `json:"content"`
}

// SelectedPrompt identifies a saved prompt to attach to the trace via
// SetSelectedPrompt. If set on multiple spans, the last one wins.
type SelectedPrompt struct {
	ID            string
	VersionID     string
	VersionNumber int
}

// Span wraps an OpenTelemetry span with LangWatch helpers for recording LLM,
// RAG and GenAI data. The LangWatch setters return the span for chaining; the
// embedded trace.Span methods (SetName, AddEvent, RecordError, End, …) remain
// available.
type Span struct {
	trace.Span
}

// setJSON marshals value to JSON and records it as a string attribute, logging
// (without failing) on marshalling errors.
func (s *Span) setJSON(key attribute.Key, value any) *Span {
	jsonStr, err := json.Marshal(value)
	if err != nil {
		log.Default().Printf("langwatch: error marshalling %s: %v", key, err)
		return s
	}
	s.SetAttributes(key.String(string(jsonStr)))
	return s
}

// SetInput records the span input, inferring its type from the Go value (see
// NewTypedValue). Pass a string for text, a struct/map for json, a
// []ChatMessage for chat_messages, and so on.
func (s *Span) SetInput(input any) *Span {
	return s.SetInputTyped(NewTypedValue(input))
}

// SetInputTyped records the span input from an explicit TypedValue.
func (s *Span) SetInputTyped(input TypedValue) *Span {
	return s.setJSON(AttributeLangWatchInput, input)
}

// SetInputText records the span input as plain text.
func (s *Span) SetInputText(input string) *Span {
	return s.SetInputTyped(TypedValue{Type: InputOutputTypeText, Value: input})
}

// SetInputJSON records the span input as a JSON value.
func (s *Span) SetInputJSON(input any) *Span {
	return s.SetInputTyped(TypedValue{Type: InputOutputTypeJSON, Value: input})
}

// SetInputRaw records the span input as a raw value (coerced to a string by the
// JSON marshaller for non-string payloads).
func (s *Span) SetInputRaw(input any) *Span {
	return s.SetInputTyped(TypedValue{Type: InputOutputTypeRaw, Value: input})
}

// SetInputChatMessages records the span input as a conversation. The pipeline
// derives gen_ai.input.messages from it.
func (s *Span) SetInputChatMessages(messages []ChatMessage) *Span {
	return s.SetInputTyped(TypedValue{Type: InputOutputTypeChatMessages, Value: messages})
}

// SetInputList records the span input as a list of nested typed values.
func (s *Span) SetInputList(items []TypedValue) *Span {
	return s.SetInputTyped(TypedValue{Type: InputOutputTypeList, Value: items})
}

// SetInputGuardrailResult records the span input as a guardrail result.
func (s *Span) SetInputGuardrailResult(result EvaluationResult) *Span {
	return s.SetInputTyped(TypedValue{Type: InputOutputTypeGuardrailResult, Value: result})
}

// SetInputEvaluationResult records the span input as an evaluation result.
func (s *Span) SetInputEvaluationResult(result EvaluationResult) *Span {
	return s.SetInputTyped(TypedValue{Type: InputOutputTypeEvaluationResult, Value: result})
}

// SetOutput records the span output, inferring its type from the Go value.
func (s *Span) SetOutput(output any) *Span {
	return s.SetOutputTyped(NewTypedValue(output))
}

// SetOutputTyped records the span output from an explicit TypedValue.
func (s *Span) SetOutputTyped(output TypedValue) *Span {
	return s.setJSON(AttributeLangWatchOutput, output)
}

// SetOutputText records the span output as plain text.
func (s *Span) SetOutputText(output string) *Span {
	return s.SetOutputTyped(TypedValue{Type: InputOutputTypeText, Value: output})
}

// SetOutputJSON records the span output as a JSON value.
func (s *Span) SetOutputJSON(output any) *Span {
	return s.SetOutputTyped(TypedValue{Type: InputOutputTypeJSON, Value: output})
}

// SetOutputRaw records the span output as a raw value.
func (s *Span) SetOutputRaw(output any) *Span {
	return s.SetOutputTyped(TypedValue{Type: InputOutputTypeRaw, Value: output})
}

// SetOutputChatMessages records the span output as a conversation. The pipeline
// derives gen_ai.output.messages from it.
func (s *Span) SetOutputChatMessages(messages []ChatMessage) *Span {
	return s.SetOutputTyped(TypedValue{Type: InputOutputTypeChatMessages, Value: messages})
}

// SetOutputList records the span output as a list of nested typed values.
func (s *Span) SetOutputList(items []TypedValue) *Span {
	return s.SetOutputTyped(TypedValue{Type: InputOutputTypeList, Value: items})
}

// SetOutputGuardrailResult records the span output as a guardrail result.
func (s *Span) SetOutputGuardrailResult(result EvaluationResult) *Span {
	return s.SetOutputTyped(TypedValue{Type: InputOutputTypeGuardrailResult, Value: result})
}

// SetOutputEvaluationResult records the span output as an evaluation result.
func (s *Span) SetOutputEvaluationResult(result EvaluationResult) *Span {
	return s.SetOutputTyped(TypedValue{Type: InputOutputTypeEvaluationResult, Value: result})
}

// SetType sets the span type (langwatch.span.type).
func (s *Span) SetType(spanType SpanType) *Span {
	s.SetAttributes(AttributeLangWatchSpanType.String(string(spanType)))
	return s
}

// SetRequestModel sets the requested model name (gen_ai.request.model).
func (s *Span) SetRequestModel(model string) *Span {
	s.SetAttributes(semconv.GenAIRequestModelKey.String(model))
	return s
}

// SetResponseModel sets the responding model name (gen_ai.response.model).
func (s *Span) SetResponseModel(model string) *Span {
	s.SetAttributes(semconv.GenAIResponseModelKey.String(model))
	return s
}

// SetGenAIProvider sets the GenAI provider name (gen_ai.provider.name), the
// current convention superseding gen_ai.system. Use a value from the OTel
// semconv (e.g. semconv.GenAIProviderNameOpenAI.Value.AsString()) or a custom
// provider id.
func (s *Span) SetGenAIProvider(provider string) *Span {
	s.SetAttributes(semconv.GenAIProviderNameKey.String(provider))
	return s
}

// SetMetrics records per-span token and cost metrics (langwatch.metrics).
func (s *Span) SetMetrics(metrics SpanMetrics) *Span {
	return s.setJSON(AttributeLangWatchMetrics, metrics)
}

// SetMetadata records custom trace metadata from a map.
//
// Deprecated: use SetTraceMetadata (typed, OTel-native) or SetTraceMetadataMap,
// which emit hoistable metadata.<key> attributes instead of a JSON blob.
func (s *Span) SetMetadata(metadata map[string]any) *Span {
	return s.SetTraceMetadataMap(metadata)
}

// SetThreadID groups the trace under a conversation, recorded as the OpenTelemetry
// GenAI gen_ai.conversation.id — the convention the server maps to the trace's
// thread. (Use this for multi-turn conversation grouping.)
func (s *Span) SetThreadID(threadID string) *Span {
	s.SetAttributes(attribute.String("gen_ai.conversation.id", threadID))
	return s
}

// SetTraceName sets a display name for the trace (langwatch.trace.name),
// independent of the root span's operation name.
func (s *Span) SetTraceName(name string) *Span {
	s.SetAttributes(AttributeLangWatchTraceName.String(name))
	return s
}

// SetUserID associates the trace with a user (langwatch.user.id).
func (s *Span) SetUserID(userID string) *Span {
	s.SetAttributes(AttributeLangWatchUserID.String(userID))
	return s
}

// SetCustomerID associates the trace with a customer (langwatch.customer.id).
func (s *Span) SetCustomerID(customerID string) *Span {
	s.SetAttributes(AttributeLangWatchCustomerID.String(customerID))
	return s
}

// SetLabels attaches labels to the trace (langwatch.labels).
func (s *Span) SetLabels(labels ...string) *Span {
	s.SetAttributes(AttributeLangWatchLabels.StringSlice(labels))
	return s
}

// SetParams records LLM invocation parameters (langwatch.params) as a bare JSON
// object (temperature, top_p, stop, tools, …).
func (s *Span) SetParams(params map[string]any) *Span {
	return s.setJSON(AttributeLangWatchParams, params)
}

// SetSelectedPrompt attaches a saved prompt to the trace, setting the prompt
// identity attributes the trace UI reads for the "Open in Prompts" affordance.
func (s *Span) SetSelectedPrompt(prompt SelectedPrompt) *Span {
	attrs := []attribute.KeyValue{
		AttributeLangWatchPromptSelectedID.String(prompt.ID),
		AttributeLangWatchPromptID.String(prompt.ID),
	}
	if prompt.VersionID != "" {
		attrs = append(attrs, AttributeLangWatchPromptVersionID.String(prompt.VersionID))
	}
	if prompt.VersionNumber != 0 {
		attrs = append(attrs, AttributeLangWatchPromptVersionNumber.Int(prompt.VersionNumber))
	}
	s.SetAttributes(attrs...)
	return s
}

// SetTimestamps records SDK-measured span timing (langwatch.timestamps).
func (s *Span) SetTimestamps(timestamps SpanTimestamps) *Span {
	return s.setJSON(AttributeLangWatchTimestamps, timestamps)
}

// SetRAGContexts records the retrieved chunks used as context (langwatch.rag.contexts).
func (s *Span) SetRAGContexts(contexts []SpanRAGContextChunk) *Span {
	return s.setJSON(AttributeLangWatchRAGContexts, contexts)
}

// SetRAGContext records a single retrieved chunk.
func (s *Span) SetRAGContext(context SpanRAGContextChunk) *Span {
	return s.SetRAGContexts([]SpanRAGContextChunk{context})
}
