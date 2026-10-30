package customertracebridge

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/pkg/aitrace"
)

// A decisions call often judges private messages, so its span states what
// the call cost and never what it read or answered.

// @scenario "A decisions span carries usage and cost but no input or answers"
func TestEmitter_DecisionsSpan_CarriesUsageAndCostButNoContent(t *testing.T) {
	const input = "PRIVATE-MESSAGE-TEXT"
	const answer = "PRIVATE-ANSWER-NAME"
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	e := &Emitter{tp: tp, tracer: tp.Tracer("test"), propagator: propagation.TraceContext{}}

	params := aitrace.Params{
		ProviderID:  aitrace.ProviderOpenAI,
		Model:       "gpt-6-luna",
		RequestType: aitrace.RequestTypeDecisions,
		RequestBody: []byte(`{"model":"gpt-6-luna","input":"` + input + `","messages":[{"role":"user","content":"` + input + `"}],` +
			`"questions":[{"type":"predicate","name":"q","instructions":"` + input + `"}]}`),
		ResponseBody: []byte(`{"answers":[{"type":"predicate","name":"` + answer + `","probability":0.8}],` +
			`"usage":{"input_tokens":1234,"output_tokens":7}}`),
		Usage: aitrace.Usage{PromptTokens: 1234, CompletionTokens: 7, TotalTokens: 1241, CostMicroUSD: 42},
	}
	ctx, _ := e.BeginSpan(context.Background(), "proj-test", params.RequestType)
	e.EndSpan(ctx, params)

	spans := sr.Ended()
	require.Len(t, spans, 1)
	span := spans[0]

	in, ok := findIntAttr(span, "gen_ai.usage.input_tokens")
	require.True(t, ok)
	assert.EqualValues(t, 1234, in)
	out, ok := findIntAttr(span, "gen_ai.usage.output_tokens")
	require.True(t, ok)
	assert.EqualValues(t, 7, out)
	cost, ok := findIntAttr(span, string(attrCost))
	require.True(t, ok)
	assert.EqualValues(t, 42, cost)

	for _, kv := range span.Attributes() {
		value := kv.Value.String()
		assert.NotContains(t, value, input, "attribute %s carries the input", kv.Key)
		assert.NotContains(t, value, answer, "attribute %s carries the answers", kv.Key)
		assert.False(t, strings.HasPrefix(string(kv.Key), "gen_ai.input.messages"), "no input messages on a decisions span")
		assert.False(t, strings.HasPrefix(string(kv.Key), "gen_ai.output.messages"), "no output messages on a decisions span")
	}
	for _, ev := range span.Events() {
		for _, kv := range ev.Attributes {
			assert.NotContains(t, kv.Value.String(), input)
			assert.NotContains(t, kv.Value.String(), answer)
		}
	}
}
