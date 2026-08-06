package langwatch

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// recordSpan starts a LangWatch span backed by an in-memory exporter, runs fn
// against it, ends it, and returns the recorded attributes keyed by their key.
func recordSpan(t *testing.T, fn func(s *Span)) map[attribute.Key]attribute.Value {
	t.Helper()

	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exporter)),
	)
	tracer := TracerFromProvider(provider, "test")

	_, span := tracer.Start(context.Background(), "op")
	fn(span)
	span.End() // SimpleSpanProcessor exports synchronously on End.

	// Read before any Shutdown: InMemoryExporter.Shutdown resets its buffer.
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)

	attrs := make(map[attribute.Key]attribute.Value, len(spans[0].Attributes))
	for _, kv := range spans[0].Attributes {
		attrs[kv.Key] = kv.Value
	}
	return attrs
}

// parseEnvelope decodes a {"type":...,"value":...} input/output envelope.
func parseEnvelope(t *testing.T, raw string) (string, json.RawMessage) {
	t.Helper()
	var env struct {
		Type  string          `json:"type"`
		Value json.RawMessage `json:"value"`
	}
	require.NoError(t, json.Unmarshal([]byte(raw), &env))
	return env.Type, env.Value
}

func TestSetInput(t *testing.T) {
	t.Run("a string input is recorded as text under langwatch.input", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) { s.SetInput("hello") })
		raw, ok := attrs[AttributeLangWatchInput]
		require.True(t, ok)
		typ, value := parseEnvelope(t, raw.AsString())
		assert.Equal(t, "text", typ)
		assert.JSONEq(t, `"hello"`, string(value))
	})

	t.Run("a struct input is recorded as json", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetInput(struct {
				A int `json:"a"`
			}{A: 1})
		})
		typ, _ := parseEnvelope(t, attrs[AttributeLangWatchInput].AsString())
		assert.Equal(t, "json", typ)
	})

	t.Run("chat messages are recorded as chat_messages", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetInputChatMessages([]ChatMessage{TextMessage(ChatRoleUser, "hi")})
		})
		typ, _ := parseEnvelope(t, attrs[AttributeLangWatchInput].AsString())
		assert.Equal(t, "chat_messages", typ)
	})

	t.Run("output can be forced to a guardrail result", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetOutputGuardrailResult(EvaluationResult{Status: EvaluationStatusProcessed, Passed: Bool(true)})
		})
		typ, _ := parseEnvelope(t, attrs[AttributeLangWatchOutput].AsString())
		assert.Equal(t, "guardrail_result", typ)
	})
}

func TestSetInputTypedVariants(t *testing.T) {
	cases := []struct {
		name     string
		set      func(s *Span)
		key      attribute.Key
		wantType string
	}{
		{"SetInputText", func(s *Span) { s.SetInputText("plain") }, AttributeLangWatchInput, "text"},
		{"SetInputJSON", func(s *Span) { s.SetInputJSON(map[string]any{"a": 1}) }, AttributeLangWatchInput, "json"},
		{"SetInputRaw", func(s *Span) { s.SetInputRaw(42) }, AttributeLangWatchInput, "raw"},
		{"SetInputList", func(s *Span) {
			s.SetInputList([]TypedValue{{Type: InputOutputTypeText, Value: "x"}})
		}, AttributeLangWatchInput, "list"},
		{"SetInputGuardrailResult", func(s *Span) {
			s.SetInputGuardrailResult(EvaluationResult{Status: EvaluationStatusProcessed})
		}, AttributeLangWatchInput, "guardrail_result"},
		{"SetInputEvaluationResult", func(s *Span) {
			s.SetInputEvaluationResult(EvaluationResult{Status: EvaluationStatusProcessed})
		}, AttributeLangWatchInput, "evaluation_result"},
		{"SetOutputText", func(s *Span) { s.SetOutputText("plain") }, AttributeLangWatchOutput, "text"},
		{"SetOutputJSON", func(s *Span) { s.SetOutputJSON(map[string]any{"a": 1}) }, AttributeLangWatchOutput, "json"},
		{"SetOutputRaw", func(s *Span) { s.SetOutputRaw(42) }, AttributeLangWatchOutput, "raw"},
		{"SetOutputList", func(s *Span) {
			s.SetOutputList([]TypedValue{{Type: InputOutputTypeText, Value: "x"}})
		}, AttributeLangWatchOutput, "list"},
		{"SetOutputChatMessages", func(s *Span) {
			s.SetOutputChatMessages([]ChatMessage{TextMessage(ChatRoleAssistant, "hi")})
		}, AttributeLangWatchOutput, "chat_messages"},
		{"SetOutputEvaluationResult", func(s *Span) {
			s.SetOutputEvaluationResult(EvaluationResult{Status: EvaluationStatusProcessed})
		}, AttributeLangWatchOutput, "evaluation_result"},
	}
	for _, c := range cases {
		t.Run("when "+c.name+" is used the envelope carries the right type", func(t *testing.T) {
			attrs := recordSpan(t, c.set)
			raw, ok := attrs[c.key]
			require.True(t, ok)
			typ, _ := parseEnvelope(t, raw.AsString())
			assert.Equal(t, c.wantType, typ)
		})
	}
}

func TestSetInputUsesEnvelope(t *testing.T) {
	t.Run("input and output use a type/value envelope, not a bare value", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetInputText("question").SetOutputText("answer")
		})

		// Envelope shape, not a bare JSON string.
		var in map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs[AttributeLangWatchInput].AsString()), &in))
		assert.Equal(t, "text", in["type"])
		assert.Equal(t, "question", in["value"])

		var out map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs[AttributeLangWatchOutput].AsString()), &out))
		assert.Equal(t, "text", out["type"])
		assert.Equal(t, "answer", out["value"])
	})
}

func TestSetTypeAndModels(t *testing.T) {
	t.Run("type and model setters write bare semantic-convention values", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetType(SpanTypeRAG).
				SetRequestModel("gpt-5-mini").
				SetResponseModel("gpt-5-mini-2025").
				SetGenAIProvider("openai")
		})
		assert.Equal(t, "rag", attrs[AttributeLangWatchSpanType].AsString())
		assert.Equal(t, "gpt-5-mini", attrs["gen_ai.request.model"].AsString())
		assert.Equal(t, "gpt-5-mini-2025", attrs["gen_ai.response.model"].AsString())
		assert.Equal(t, "openai", attrs["gen_ai.provider.name"].AsString())
	})
}

func TestSetParams(t *testing.T) {
	t.Run("params are recorded as a bare json object", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetParams(map[string]any{"temperature": 0.7, "stop": []string{"\n"}})
		})
		raw, ok := attrs[AttributeLangWatchParams]
		require.True(t, ok)

		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &m))
		// Bare object — NOT wrapped in a {"type":...,"value":...} envelope.
		assert.NotContains(t, m, "type")
		assert.NotContains(t, m, "value")
		assert.EqualValues(t, 0.7, m["temperature"])
	})
}

func TestSetSelectedPromptOmitsZeroVersion(t *testing.T) {
	t.Run("a zero version number is omitted", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetSelectedPrompt(SelectedPrompt{ID: "prompt-1"})
		})
		assert.Equal(t, "prompt-1", attrs[AttributeLangWatchPromptSelectedID].AsString())
		assert.Equal(t, "prompt-1", attrs[AttributeLangWatchPromptID].AsString())
		_, hasVersionNumber := attrs[AttributeLangWatchPromptVersionNumber]
		assert.False(t, hasVersionNumber, "a zero VersionNumber must not be emitted")
		_, hasVersionID := attrs[AttributeLangWatchPromptVersionID]
		assert.False(t, hasVersionID, "an empty VersionID must not be emitted")
	})
}

func TestSetTimestampsWithFirstToken(t *testing.T) {
	t.Run("a first-token timestamp pointer is recorded when set", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			ft := int64(1500)
			s.SetTimestamps(SpanTimestamps{StartedAtUnix: 1000, FirstTokenAtUnix: &ft, FinishedAtUnix: 2000})
		})
		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs[AttributeLangWatchTimestamps].AsString()), &m))
		assert.EqualValues(t, 1000, m["started_at"])
		assert.EqualValues(t, 1500, m["first_token_at"])
		assert.EqualValues(t, 2000, m["finished_at"])
	})

	t.Run("an unset first-token timestamp is omitted", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTimestamps(SpanTimestamps{StartedAtUnix: 1000, FinishedAtUnix: 2000})
		})
		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs[AttributeLangWatchTimestamps].AsString()), &m))
		assert.NotContains(t, m, "first_token_at")
	})
}

func TestSetRAGContextSingular(t *testing.T) {
	t.Run("a single context is wrapped into the bare array", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetRAGContext(SpanRAGContextChunk{DocumentID: "doc-1", Content: "passage"})
		})
		raw, ok := attrs[AttributeLangWatchRAGContexts]
		require.True(t, ok)

		var chunks []map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &chunks))
		require.Len(t, chunks, 1)
		assert.Equal(t, "doc-1", chunks[0]["document_id"])
		assert.Equal(t, "passage", chunks[0]["content"])
	})
}

func TestSetJSONMarshalError(t *testing.T) {
	t.Run("an unmarshalable value is skipped without panicking or recording", func(t *testing.T) {
		// A channel cannot be JSON-encoded; setJSON logs and returns the span
		// untouched rather than failing. SetInput wraps it as a json TypedValue
		// whose Value is the channel, so json.Marshal of the envelope errors.
		attrs := recordSpan(t, func(s *Span) {
			s.SetInput(make(chan int))
		})
		_, recorded := attrs[AttributeLangWatchInput]
		assert.False(t, recorded, "an unmarshalable input must not be recorded")
	})

	t.Run("it returns the same span for chaining on a marshal error", func(t *testing.T) {
		recordSpan(t, func(s *Span) {
			returned := s.SetInput(make(chan int))
			assert.Same(t, s, returned)
		})
	})
}

func TestSetMetrics(t *testing.T) {
	t.Run("metrics are recorded as a bare snake_case object", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetMetrics(SpanMetrics{
				Cost:            Float64(0.0125),
				TokensEstimated: Bool(true),
			})
		})

		raw, ok := attrs[AttributeLangWatchMetrics]
		require.True(t, ok)

		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &m))

		// Bare object — NOT wrapped in a {"type":"json","value":...} envelope.
		assert.NotContains(t, m, "type")
		assert.NotContains(t, m, "value")
		assert.EqualValues(t, 0.0125, m["cost"])
		assert.Equal(t, true, m["tokens_estimated"])
		// Token counts are no longer carried by langwatch.metrics — they live in
		// gen_ai.usage.* (see SetGenAIUsage).
		assert.NotContains(t, m, "prompt_tokens")
		assert.NotContains(t, m, "completion_tokens")
	})
}

func TestSetTraceMetadata(t *testing.T) {
	t.Run("it records individual hoistable metadata.<key> attributes, not a blob", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTraceMetadata(
				Origin("api"),
				attribute.String("feature", "checkout"),
				attribute.Int("attempt", 2),
			)
		})
		assert.Equal(t, "api", attrs["metadata.origin"].AsString())
		assert.Equal(t, "checkout", attrs["metadata.feature"].AsString())
		assert.EqualValues(t, 2, attrs["metadata.attempt"].AsInt64())
		_, blob := attrs[AttributeLangWatchMetadata]
		assert.False(t, blob, "no langwatch.metadata JSON blob is emitted")
	})

	t.Run("the map convenience and SetOrigin namespace under metadata.", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTraceMetadataMap(map[string]any{"tier": "pro", "retries": 3}).SetOrigin("cron")
		})
		assert.Equal(t, "pro", attrs["metadata.tier"].AsString())
		assert.EqualValues(t, 3, attrs["metadata.retries"].AsInt64())
		assert.Equal(t, "cron", attrs["metadata.origin"].AsString())
	})

	t.Run("an already-namespaced key is not double-prefixed", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTraceMetadata(attribute.String("metadata.foo", "bar"))
		})
		assert.Equal(t, "bar", attrs["metadata.foo"].AsString())
		_, doubled := attrs["metadata.metadata.foo"]
		assert.False(t, doubled)
	})
}

func TestSetRAGContexts(t *testing.T) {
	t.Run("contexts use the canonical key and a bare array", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetRAGContexts([]SpanRAGContextChunk{
				{DocumentID: "doc-1", ChunkID: "c-1", Content: "passage"},
			})
		})

		raw, ok := attrs[AttributeLangWatchRAGContexts]
		require.True(t, ok, "must emit langwatch.rag.contexts")
		assert.Equal(t, attribute.Key("langwatch.rag.contexts"), AttributeLangWatchRAGContexts)

		// The legacy/unrecognised key must NOT be emitted.
		_, legacy := attrs[attribute.Key("langwatch.contexts")]
		assert.False(t, legacy, "must not emit the unrecognised langwatch.contexts key")

		// Bare array, not a {"type":...,"value":...} envelope.
		var chunks []map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &chunks))
		require.Len(t, chunks, 1)
		assert.Equal(t, "doc-1", chunks[0]["document_id"])
		assert.Equal(t, "passage", chunks[0]["content"])
	})
}

func TestReservedMetadataSetters(t *testing.T) {
	t.Run("identity setters write the canonical reserved keys", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetThreadID("t-1").SetUserID("u-1").SetCustomerID("c-1").SetLabels("a", "b")
		})
		assert.Equal(t, "t-1", attrs["gen_ai.conversation.id"].AsString(), "thread maps to gen_ai.conversation.id")
		assert.Equal(t, "u-1", attrs[AttributeLangWatchUserID].AsString())
		assert.Equal(t, "c-1", attrs[AttributeLangWatchCustomerID].AsString())
		assert.Equal(t, []string{"a", "b"}, attrs[AttributeLangWatchLabels].AsStringSlice())
	})
}

func TestSetSelectedPrompt(t *testing.T) {
	t.Run("it sets the prompt identity attributes", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetSelectedPrompt(SelectedPrompt{ID: "prompt-1", VersionID: "ver-1", VersionNumber: 6})
		})
		assert.Equal(t, "prompt-1", attrs[AttributeLangWatchPromptSelectedID].AsString())
		assert.Equal(t, "prompt-1", attrs[AttributeLangWatchPromptID].AsString())
		assert.Equal(t, "ver-1", attrs[AttributeLangWatchPromptVersionID].AsString())
		assert.EqualValues(t, 6, attrs[AttributeLangWatchPromptVersionNumber].AsInt64())
	})
}

func TestSetTimestamps(t *testing.T) {
	t.Run("timestamps are recorded as a bare object", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTimestamps(SpanTimestamps{StartedAtUnix: 1000, FinishedAtUnix: 2000})
		})
		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs[AttributeLangWatchTimestamps].AsString()), &m))
		assert.NotContains(t, m, "type")
		assert.EqualValues(t, 1000, m["started_at"])
		assert.EqualValues(t, 2000, m["finished_at"])
	})
}

func TestFluentChaining(t *testing.T) {
	t.Run("LangWatch setters return the span for chaining", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetType(SpanTypeLLM).
				SetRequestModel("gpt-5-mini").
				SetInput("hi").
				SetOutput("yo")
		})
		assert.Equal(t, "llm", attrs[AttributeLangWatchSpanType].AsString())
		assert.Equal(t, "gpt-5-mini", attrs["gen_ai.request.model"].AsString())
		assert.Contains(t, attrs, AttributeLangWatchInput)
		assert.Contains(t, attrs, AttributeLangWatchOutput)
	})
}
