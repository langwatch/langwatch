package langwatch

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
)

func TestSetInput(t *testing.T) {
	// @scenario "A string input is recorded as text"
	t.Run("a string input is recorded as text under langwatch.input", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) { s.SetInput("hello") })
		raw, ok := attrs[AttributeLangWatchInput]
		require.True(t, ok)
		typ, value := parseEnvelope(t, raw.AsString())
		assert.Equal(t, "text", typ)
		assert.JSONEq(t, `"hello"`, string(value))
	})

	// @scenario "A struct input is recorded as json"
	t.Run("a struct input is recorded as json", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetInput(struct {
				A int `json:"a"`
			}{A: 1})
		})
		typ, _ := parseEnvelope(t, attrs[AttributeLangWatchInput].AsString())
		assert.Equal(t, "json", typ)
	})

	// @scenario "Chat messages are recorded as chat_messages"
	t.Run("chat messages are recorded as chat_messages", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetInputChatMessages([]ChatMessage{TextMessage(ChatRoleUser, "hi")})
		})
		typ, _ := parseEnvelope(t, attrs[AttributeLangWatchInput].AsString())
		assert.Equal(t, "chat_messages", typ)
	})

	// @scenario "The developer forces a value type"
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
