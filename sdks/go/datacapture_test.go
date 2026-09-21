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
	"go.opentelemetry.io/otel/trace"
)

// captureStub pairs every content attribute the capture stage can strip with a
// non-content one it must never touch, so a test that asserts stripping cannot
// pass by simply dropping everything.
func captureStub(spanType string) tracetest.SpanStub {
	return tracetest.SpanStub{
		Name:     "op",
		SpanKind: trace.SpanKindClient,
		Attributes: []attribute.KeyValue{
			AttributeLangWatchInput.String(`{"type":"text","value":"hi"}`),
			AttributeLangWatchOutput.String(`{"type":"text","value":"yo"}`),
			AttributeLangWatchSpanType.String(spanType),
			attribute.String("gen_ai.input.messages", "[]"),
			attribute.String("gen_ai.output.messages", "[]"),
			attribute.String("gen_ai.request.model", "gpt-5-mini"),
		},
	}
}

func keySet(attrs []attribute.KeyValue) map[attribute.Key]struct{} {
	m := make(map[attribute.Key]struct{}, len(attrs))
	for _, kv := range attrs {
		m[kv.Key] = struct{}{}
	}
	return m
}

func TestDataCaptureModeTruthTable(t *testing.T) {
	cases := []struct {
		mode       DataCaptureMode
		wantInput  bool
		wantOutput bool
	}{
		{DataCaptureAll, true, true},
		{DataCaptureInput, true, false},
		{DataCaptureOutput, false, true},
		{DataCaptureNone, false, false},
	}
	for _, c := range cases {
		t.Run("when mode is "+string(c.mode), func(t *testing.T) {
			assert.Equal(t, c.wantInput, c.mode.CaptureInput())
			assert.Equal(t, c.wantOutput, c.mode.CaptureOutput())
		})
	}
}

func TestDataCaptureConfigResolve(t *testing.T) {
	t.Run("when no predicate is set it returns the fixed mode", func(t *testing.T) {
		cfg := dataCaptureConfig{enabled: true, mode: DataCaptureInput}
		assert.Equal(t, DataCaptureInput, cfg.resolve(captureStub("llm").Snapshot()))
	})

	t.Run("when a predicate is set it is consulted and receives a populated context", func(t *testing.T) {
		var got DataCaptureContext
		cfg := dataCaptureConfig{
			enabled: true,
			predicate: func(c DataCaptureContext) DataCaptureMode {
				got = c
				return DataCaptureNone
			},
		}

		mode := cfg.resolve(captureStub("tool").Snapshot())
		assert.Equal(t, DataCaptureNone, mode)

		// Every field of the context the predicate sees must be populated.
		assert.Equal(t, "op", got.SpanName)
		assert.Equal(t, trace.SpanKindClient, got.SpanKind)
		assert.Equal(t, "tool", got.SpanType)
		assert.NotEmpty(t, got.Attributes, "the predicate must see the span attributes")

		// The attributes carry the recorded keys.
		keys := keySet(got.Attributes)
		assert.Contains(t, keys, AttributeLangWatchInput)
		assert.Contains(t, keys, attribute.Key("gen_ai.request.model"))
	})
}

func TestSpanTypeAttr(t *testing.T) {
	t.Run("when the span has a type attribute it is returned", func(t *testing.T) {
		assert.Equal(t, "rag", spanTypeAttr(captureStub("rag").Snapshot()))
	})

	t.Run("when the span has no type attribute it returns empty", func(t *testing.T) {
		stub := tracetest.SpanStub{
			Name: "op",
			Attributes: []attribute.KeyValue{
				attribute.String("gen_ai.request.model", "gpt-5-mini"),
			},
		}
		assert.Empty(t, spanTypeAttr(stub.Snapshot()))
	})
}

func TestApplyDataCaptureIdentity(t *testing.T) {
	t.Run("when capture is full the original span is returned unchanged", func(t *testing.T) {
		original := captureStub("llm").Snapshot()
		out := applyDataCapture(original, DataCaptureAll)
		// No stripping means the exact same span value is returned (not a wrapper).
		assert.Equal(t, original, out)
	})
}

func TestDataCaptureStripsInstructions(t *testing.T) {
	t.Run("disabling input capture strips langwatch.instructions (a system-prompt leak)", func(t *testing.T) {
		stub := tracetest.SpanStub{
			Name: "op",
			Attributes: []attribute.KeyValue{
				AttributeLangWatchInstructions.String("you are a helpful assistant"),
				AttributeLangWatchSpanType.String("llm"),
			},
		}
		out := applyDataCapture(stub.Snapshot(), DataCaptureNone)
		keys := keySet(out.Attributes())
		assert.NotContains(t, keys, AttributeLangWatchInstructions, "system instructions must be stripped with input")
		assert.Contains(t, keys, AttributeLangWatchSpanType, "structure is preserved")
	})
}

func TestApplyDataCapture(t *testing.T) {
	cases := []struct {
		mode       DataCaptureMode
		wantInput  bool
		wantOutput bool
	}{
		{DataCaptureAll, true, true},
		{DataCaptureInput, true, false},
		{DataCaptureOutput, false, true},
		{DataCaptureNone, false, false},
	}
	for _, c := range cases {
		t.Run(string(c.mode), func(t *testing.T) {
			out := applyDataCapture(captureStub("llm").Snapshot(), c.mode)
			keys := keySet(out.Attributes())

			_, lwIn := keys[AttributeLangWatchInput]
			_, genIn := keys[attribute.Key("gen_ai.input.messages")]
			_, lwOut := keys[AttributeLangWatchOutput]
			_, genOut := keys[attribute.Key("gen_ai.output.messages")]

			assert.Equal(t, c.wantInput, lwIn, "langwatch.input presence")
			assert.Equal(t, c.wantInput, genIn, "gen_ai.input.messages presence")
			assert.Equal(t, c.wantOutput, lwOut, "langwatch.output presence")
			assert.Equal(t, c.wantOutput, genOut, "gen_ai.output.messages presence")

			// Structure/identity attributes are always preserved.
			assert.Contains(t, keys, AttributeLangWatchSpanType)
			assert.Contains(t, keys, attribute.Key("gen_ai.request.model"))
		})
	}
}

func TestDataCaptureStripsRAGContexts(t *testing.T) {
	t.Run("disabling input capture strips the retrieved document text", func(t *testing.T) {
		stub := tracetest.SpanStub{
			Name: "op",
			Attributes: []attribute.KeyValue{
				AttributeLangWatchRAGContexts.String(`[{"document_id":"doc-1","content":"secret passage"}]`),
				AttributeLangWatchSpanType.String("rag"),
			},
		}
		out := applyDataCapture(stub.Snapshot(), DataCaptureNone)
		keys := keySet(out.Attributes())
		assert.NotContains(t, keys, AttributeLangWatchRAGContexts, "retrieved document text must be stripped")
		assert.Contains(t, keys, AttributeLangWatchSpanType, "structure is preserved")
	})

	t.Run("capturing input keeps them", func(t *testing.T) {
		stub := tracetest.SpanStub{
			Name:       "op",
			Attributes: []attribute.KeyValue{AttributeLangWatchRAGContexts.String("[]")},
		}
		out := applyDataCapture(stub.Snapshot(), DataCaptureInput)
		assert.Contains(t, keySet(out.Attributes()), AttributeLangWatchRAGContexts)
	})
}

func TestDataCaptureStripsRequestContent(t *testing.T) {
	// Content the extractors record BEFORE any capture decision: the customer's
	// own tool schemas, their compiled prompt variables and an arbitrary
	// caller-supplied params map. Every one is input content.
	contentKeys := []attribute.Key{
		AttributeGenAIRequestTools,
		AttributeLangWatchPromptVariables,
		AttributeLangWatchParams,
	}
	stub := func() tracetest.SpanStub {
		return tracetest.SpanStub{
			Name: "op",
			Attributes: []attribute.KeyValue{
				AttributeGenAIRequestTools.String(`[{"function":{"name":"charge_card","description":"charges the customer's card"}}]`),
				AttributeLangWatchPromptVariables.String(`{"type":"json","value":{"ssn":"123-45-6789"}}`),
				AttributeLangWatchParams.String(`{"type":"json","value":{"tenant":"acme"}}`),
				AttributeGenAIRequestToolChoice.String("auto"),
				AttributeLangWatchSpanType.String("llm"),
			},
		}
	}

	for _, mode := range []DataCaptureMode{DataCaptureNone, DataCaptureOutput} {
		t.Run("when input capture is off in mode "+string(mode), func(t *testing.T) {
			keys := keySet(applyDataCapture(stub().Snapshot(), mode).Attributes())
			for _, key := range contentKeys {
				assert.NotContains(t, keys, key, "%s carries request content and must be stripped", key)
			}
			assert.Contains(t, keys, AttributeGenAIRequestToolChoice, "tool_choice is a control directive, deliberately kept")
			assert.Contains(t, keys, AttributeLangWatchSpanType, "structure is preserved")
		})
	}

	for _, mode := range []DataCaptureMode{DataCaptureAll, DataCaptureInput} {
		t.Run("when input capture is on in mode "+string(mode), func(t *testing.T) {
			keys := keySet(applyDataCapture(stub().Snapshot(), mode).Attributes())
			for _, key := range contentKeys {
				assert.Contains(t, keys, key, "%s must survive when input is captured", key)
			}
		})
	}
}

func TestDataCaptureStripsEventContent(t *testing.T) {
	eventStub := func() tracetest.SpanStub {
		return tracetest.SpanStub{
			Name: "op",
			Events: []sdktrace.Event{
				{
					Name: string(AttributeLangWatchEvent),
					Attributes: []attribute.KeyValue{
						AttributeEventType.String("thumbs_up_down"),
						attribute.Float64(EventMetricsPrefix+"vote", 1),
						attribute.String(EventDetailsPrefix+"feedback", "my card ending 4242 was declined"),
					},
				},
				{
					Name: string(AttributeLangWatchEvaluationCustom),
					Attributes: []attribute.KeyValue{
						AttributeEvaluationPayload.String(
							`{"name":"answer relevancy","status":"processed","passed":true,"score":0.92,"details":"the answer quotes the user's address"}`),
					},
				},
			},
		}
	}

	eventAttrs := func(event sdktrace.Event) map[attribute.Key]attribute.Value {
		m := make(map[attribute.Key]attribute.Value, len(event.Attributes))
		for _, kv := range event.Attributes {
			m[kv.Key] = kv.Value
		}
		return m
	}

	t.Run("capturing nothing drops the free-text annotation but keeps the signal", func(t *testing.T) {
		out := applyDataCapture(eventStub().Snapshot(), DataCaptureNone)
		events := out.Events()
		require.Len(t, events, 2)

		tracked := eventAttrs(events[0])
		assert.Equal(t, "thumbs_up_down", tracked[AttributeEventType].AsString())
		assert.InDelta(t, 1, tracked[EventMetricsPrefix+"vote"].AsFloat64(), 1e-9)
		assert.NotContains(t, tracked, attribute.Key(EventDetailsPrefix+"feedback"),
			"free-text feedback must not leave the process")
	})

	t.Run("capturing nothing redacts the evaluation details but keeps its score", func(t *testing.T) {
		out := applyDataCapture(eventStub().Snapshot(), DataCaptureNone)
		events := out.Events()
		require.Len(t, events, 2)

		payload := eventAttrs(events[1])[AttributeEvaluationPayload].AsString()
		var eval map[string]any
		require.NoError(t, json.Unmarshal([]byte(payload), &eval))
		assert.NotContains(t, eval, "details", "the evaluation's free text must be redacted")
		assert.Equal(t, "answer relevancy", eval["name"])
		assert.Equal(t, true, eval["passed"])
		assert.InDelta(t, 0.92, eval["score"], 1e-9)
	})

	t.Run("an undecodable evaluation payload is dropped rather than forwarded", func(t *testing.T) {
		stub := tracetest.SpanStub{
			Name: "op",
			Events: []sdktrace.Event{{
				Name:       string(AttributeLangWatchEvaluationCustom),
				Attributes: []attribute.KeyValue{AttributeEvaluationPayload.String("not json")},
			}},
		}
		out := applyDataCapture(stub.Snapshot(), DataCaptureNone)
		require.Len(t, out.Events(), 1)
		assert.Empty(t, out.Events()[0].Attributes)
	})

	t.Run("a partial mode leaves events untouched", func(t *testing.T) {
		out := applyDataCapture(eventStub().Snapshot(), DataCaptureInput)
		tracked := eventAttrs(out.Events()[0])
		assert.Contains(t, tracked, attribute.Key(EventDetailsPrefix+"feedback"))
	})
}

// @scenario "Capturing nothing strips input and output"
func TestFilteringExporterStripsContent(t *testing.T) {
	t.Run("a none-mode exporter drops input/output before the wrapped exporter", func(t *testing.T) {
		mem := tracetest.NewInMemoryExporter()
		fe := newFilteringExporter(mem, dataCaptureConfig{enabled: true, mode: DataCaptureNone})

		require.NoError(t, fe.ExportSpans(context.Background(),
			[]sdktrace.ReadOnlySpan{captureStub("llm").Snapshot()}))

		spans := mem.GetSpans()
		require.Len(t, spans, 1)
		keys := keySet(spans[0].Attributes)
		assert.NotContains(t, keys, AttributeLangWatchInput)
		assert.NotContains(t, keys, AttributeLangWatchOutput)
		assert.Contains(t, keys, AttributeLangWatchSpanType)
	})
}

// @scenario "A predicate decides capture per span"
func TestDataCapturePredicate(t *testing.T) {
	t.Run("the predicate decides capture per span by type", func(t *testing.T) {
		mem := tracetest.NewInMemoryExporter()
		fe := newFilteringExporter(mem, dataCaptureConfig{
			enabled: true,
			predicate: func(c DataCaptureContext) DataCaptureMode {
				if c.SpanType == "tool" {
					return DataCaptureNone
				}
				return DataCaptureAll
			},
		})

		require.NoError(t, fe.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{
			captureStub("tool").Snapshot(),
			captureStub("llm").Snapshot(),
		}))

		spans := mem.GetSpans()
		require.Len(t, spans, 2)

		tool := keySet(spans[0].Attributes)
		llm := keySet(spans[1].Attributes)

		assert.NotContains(t, tool, AttributeLangWatchInput, "tool span input stripped")
		assert.NotContains(t, tool, AttributeLangWatchOutput, "tool span output stripped")
		assert.Contains(t, llm, AttributeLangWatchInput, "llm span input kept")
		assert.Contains(t, llm, AttributeLangWatchOutput, "llm span output kept")
	})
}
