package langwatch

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// recordSpanStub records a span and returns its exported stub (attributes + events).
func recordSpanStub(t *testing.T, fn func(s *Span)) tracetest.SpanStub {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exporter)))
	_, span := TracerFromProvider(provider, "test").Start(context.Background(), "op")
	fn(span)
	span.End()
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	return spans[0]
}

func TestSetGenAIMessages(t *testing.T) {
	t.Run("input/output messages are emitted in the gen_ai format", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIInputMessages([]ChatMessage{TextMessage(ChatRoleUser, "hello")}).
				SetGenAIOutputMessages([]ChatMessage{TextMessage(ChatRoleAssistant, "hi there")}).
				SetGenAISystemInstructions("be terse")
		})

		var in []map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs["gen_ai.input.messages"].AsString()), &in))
		require.Len(t, in, 1)
		assert.Equal(t, "user", in[0]["role"])
		assert.Equal(t, "hello", in[0]["content"])

		var out []map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs["gen_ai.output.messages"].AsString()), &out))
		assert.Equal(t, "assistant", out[0]["role"])

		assert.Equal(t, "be terse", attrs["gen_ai.system_instructions"].AsString())
		// gen_ai-native: SetGenAI* does NOT also write the langwatch.input envelope.
		_, lw := attrs[AttributeLangWatchInput]
		assert.False(t, lw, "SetGenAIInputMessages is gen_ai-native, not langwatch.input")
	})
}

func TestSetTraceName(t *testing.T) {
	t.Run("it records langwatch.trace.name", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) { s.SetTraceName("Checkout flow") })
		assert.Equal(t, "Checkout flow", attrs[AttributeLangWatchTraceName].AsString())
	})
}

func TestSDKAttributes(t *testing.T) {
	t.Run("every span the tracer starts carries the SDK identity for analytics", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {})
		assert.Equal(t, "langwatch-sdk-go", attrs[AttributeLangWatchSDKName].AsString())
		assert.Equal(t, "go", attrs[AttributeLangWatchSDKLanguage].AsString())
		assert.Equal(t, Version, attrs[AttributeLangWatchSDKVersion].AsString())
	})
}

func TestRecordEvaluation(t *testing.T) {
	t.Run("it adds a langwatch.evaluation.custom event with the REST payload", func(t *testing.T) {
		stub := recordSpanStub(t, func(s *Span) {
			s.RecordEvaluation(Evaluation{
				Name:   "answer relevancy",
				Passed: Bool(true),
				Score:  Float64(0.92),
				Label:  "relevant",
			})
		})

		require.Len(t, stub.Events, 1)
		ev := stub.Events[0]
		assert.Equal(t, "langwatch.evaluation.custom", ev.Name)

		var payload string
		for _, kv := range ev.Attributes {
			if kv.Key == "json_encoded_event" {
				payload = kv.Value.AsString()
			}
		}
		require.NotEmpty(t, payload, "the event must carry json_encoded_event")

		var eval map[string]any
		require.NoError(t, json.Unmarshal([]byte(payload), &eval))
		assert.Equal(t, "answer relevancy", eval["name"])
		assert.Equal(t, "processed", eval["status"], "status defaults to processed")
		assert.Equal(t, true, eval["passed"])
		assert.EqualValues(t, 0.92, eval["score"])
		assert.Equal(t, "relevant", eval["label"])
	})
}

func TestRecordEvent(t *testing.T) {
	t.Run("thumbs up records a thumbs_up_down event with vote +1 and feedback", func(t *testing.T) {
		stub := recordSpanStub(t, func(s *Span) { s.RecordThumbsUp("great answer") })
		require.Len(t, stub.Events, 1)
		ev := stub.Events[0]
		assert.Equal(t, "langwatch.event", ev.Name)

		got := map[string]string{}
		var vote float64
		for _, kv := range ev.Attributes {
			if string(kv.Key) == "event.metrics.vote" {
				vote = kv.Value.AsFloat64()
				continue
			}
			got[string(kv.Key)] = kv.Value.AsString()
		}
		assert.Equal(t, "thumbs_up_down", got["event.type"])
		assert.EqualValues(t, 1, vote)
		assert.Equal(t, "great answer", got["event.details.feedback"])
	})

	t.Run("thumbs down records vote -1 with no feedback detail", func(t *testing.T) {
		stub := recordSpanStub(t, func(s *Span) { s.RecordThumbsDown() })
		ev := stub.Events[0]
		var vote float64
		hasFeedback := false
		for _, kv := range ev.Attributes {
			switch string(kv.Key) {
			case "event.metrics.vote":
				vote = kv.Value.AsFloat64()
			case "event.details.feedback":
				hasFeedback = true
			}
		}
		assert.EqualValues(t, -1, vote)
		assert.False(t, hasFeedback)
	})
}
