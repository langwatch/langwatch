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

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Image tokens on the customer span, and what an image span may carry as
// content. domain.Usage keeps the image counts OUT of the text totals so every
// consumer prices them at the image rate, and the response body, which is
// base64 pixels, never lands on a span.

// recordImageSpan runs the emitter's span lifecycle for an image request.
func recordImageSpan(t *testing.T, params domain.AITraceParams) sdktrace.ReadOnlySpan {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	e := &Emitter{tp: tp, tracer: tp.Tracer("test"), propagator: propagation.TraceContext{}}

	ctx, _ := e.BeginSpan(context.Background(), "proj-test", params.RequestType)
	e.EndSpan(ctx, params)

	spans := sr.Ended()
	require.Len(t, spans, 1)
	return spans[0]
}

/** @scenario A span states its image tokens apart from its text tokens */
func TestEmitter_ImageTokens_AreStatedApartFromTheTextTotals(t *testing.T) {
	span := recordImageSpan(t, domain.AITraceParams{
		ProviderID:  domain.ProviderOpenAI,
		Model:       "gpt-image-2",
		RequestType: domain.RequestTypeImageGeneration,
		Usage: domain.Usage{
			PromptTokens:      14,
			OutputImageTokens: 196,
			ImageCount:        1,
			TotalTokens:       210,
		},
	})

	input, ok := findIntAttr(span, "gen_ai.usage.input_tokens")
	require.True(t, ok)
	assert.EqualValues(t, 14, input, "the text total excludes image tokens")

	outputImage, ok := findIntAttr(span, AttrGenAIUsageOutputImageTokens)
	require.True(t, ok)
	assert.EqualValues(t, 196, outputImage)

	count, ok := findIntAttr(span, AttrGenAIUsageImageCount)
	require.True(t, ok)
	assert.EqualValues(t, 1, count)

	_, hasInputImage := findIntAttr(span, AttrGenAIUsageInputImageTokens)
	assert.False(t, hasInputImage, "a generation reads no input images")
}

/** @scenario A span states its image tokens apart from its text tokens */
func TestEmitter_ImageEdit_StatesTheInputImageTokens(t *testing.T) {
	span := recordImageSpan(t, domain.AITraceParams{
		ProviderID:  domain.ProviderOpenAI,
		Model:       "gpt-image-2",
		RequestType: domain.RequestTypeImageEdit,
		Usage: domain.Usage{
			PromptTokens:      20,
			InputImageTokens:  320,
			OutputImageTokens: 1568,
			ImageCount:        2,
		},
	})

	inputImage, ok := findIntAttr(span, AttrGenAIUsageInputImageTokens)
	require.True(t, ok)
	assert.EqualValues(t, 320, inputImage)

	count, ok := findIntAttr(span, AttrGenAIUsageImageCount)
	require.True(t, ok)
	assert.EqualValues(t, 2, count)
}

func TestEmitter_NoImageTokens_LeavesTheImageAttributesOff(t *testing.T) {
	span := recordImageSpan(t, domain.AITraceParams{
		ProviderID:  domain.ProviderOpenAI,
		Model:       "gpt-5-mini",
		RequestType: domain.RequestTypeChat,
		Usage:       domain.Usage{PromptTokens: 200, CompletionTokens: 50},
	})

	_, hasInput := findIntAttr(span, AttrGenAIUsageInputImageTokens)
	assert.False(t, hasInput, "a text-only call states no image input")
	_, hasOutput := findIntAttr(span, AttrGenAIUsageOutputImageTokens)
	assert.False(t, hasOutput, "a text-only call states no image output")
	_, hasCount := findIntAttr(span, AttrGenAIUsageImageCount)
	assert.False(t, hasCount, "a text-only call returns no images")
}

/** @scenario An image span carries the prompt and never the pixels */
func TestExtractInputMessages_ImageRoutesCarryThePrompt(t *testing.T) {
	body := []byte(`{"model":"gpt-image-2","prompt":"a red bicycle on a beach"}`)
	want := `[{"role":"user","content":"a red bicycle on a beach"}]`

	for _, reqType := range []domain.RequestType{
		domain.RequestTypeImageGeneration, domain.RequestTypeImageEdit,
	} {
		assert.Equal(t, want, extractInputMessages(body, reqType), "request type %s", reqType)
	}
}

func TestExtractInputMessages_ImageWithoutPromptIsEmpty(t *testing.T) {
	assert.Empty(t, extractInputMessages([]byte(`{"model":"gpt-image-2"}`), domain.RequestTypeImageGeneration))
}

/** @scenario An image span carries the prompt and never the pixels */
func TestExtractOutputMessages_ImageBodyNeverReachesTheSpan(t *testing.T) {
	// A megabyte of base64 pixels, the shape a real answer has.
	body := []byte(`{"created":1,"data":[{"b64_json":"` + strings.Repeat("A", 1<<20) + `"}]}`)

	for _, reqType := range []domain.RequestType{
		domain.RequestTypeImageGeneration, domain.RequestTypeImageEdit,
	} {
		assert.Empty(t, extractOutputMessages(body, reqType), "request type %s", reqType)
	}
}

func TestExtractOutputMessages_ImageRevisedPromptIsRendered(t *testing.T) {
	body := []byte(`{"created":1,"data":[{"b64_json":"AAAA","revised_prompt":"a red bicycle, side view"}]}`)
	want := `[{"role":"assistant","content":"a red bicycle, side view"}]`

	assert.Equal(t, want, extractOutputMessages(body, domain.RequestTypeImageGeneration))
}

/** @scenario An image call attributes its end user like chat does */
func TestEndUserID_ImageRoutesReadTheOpenAIUserField(t *testing.T) {
	body := []byte(`{"model":"gpt-image-2","prompt":"a bicycle","user":"customer-42"}`)

	for _, reqType := range []domain.RequestType{
		domain.RequestTypeImageGeneration, domain.RequestTypeImageEdit,
	} {
		got := endUserID(context.Background(), domain.AITraceParams{
			RequestType: reqType,
			RequestBody: body,
		})
		assert.Equal(t, "customer-42", got, "request type %s", reqType)
	}
}
