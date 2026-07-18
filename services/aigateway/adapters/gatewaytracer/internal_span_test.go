package gatewaytracer

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	secretPrompt     = "my database password is hunter2, summarize the attached patient record"
	secretCompletion = "Certainly — the patient record for Jane Doe indicates a diagnosis of"
	secretSystem     = "You are an assistant for ACME Corp. The internal API key is sk-live-abc123."
)

// stampedSpan runs StampInternalGenAI over a real recording span and returns
// the finished span as the exporter would see it.
func stampedSpan(t *testing.T, params domain.AITraceParams) sdktrace.ReadOnlySpan {
	t.Helper()
	exp := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exp),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	ctx, span := tp.Tracer("test").Start(context.Background(), "lw_gateway.chat_completions")
	StampInternalGenAI(ctx, params)
	// SimpleSpanProcessor exports on End. Do NOT Shutdown the provider before
	// reading: InMemoryExporter.Shutdown resets the recorder, which would leave
	// every assertion below iterating an empty attribute set and passing
	// vacuously.
	span.End()

	spans := exp.GetSpans().Snapshots()
	require.Len(t, spans, 1)
	// Guard the guards: the leak assertions below are loops over attributes, so
	// they only mean something if attributes were actually stamped.
	require.NotEmpty(t, spans[0].Attributes(), "no attributes stamped — assertions would be vacuous")
	return spans[0]
}

// paramsWithBodies is a realistic end-of-request params: full request and
// response bodies present, exactly as the pipeline assembles them.
func paramsWithBodies() domain.AITraceParams {
	return domain.AITraceParams{
		ProjectID:          "proj-1",
		Model:              "customer-controlled-request-model",
		ProviderID:         domain.ProviderID("customer-controlled-provider"),
		InternalModel:      "gpt-5-mini",
		InternalProviderID: domain.ProviderID("openai"),
		RequestType:        domain.RequestType("chat"),
		VirtualKeyID:       "vk-1",
		GatewayRequestID:   "req-1",
		Usage: domain.Usage{
			PromptTokens:     120,
			CompletionTokens: 34,
			TotalTokens:      154,
			CostMicroUSD:     2500,
			Model:            "customer-controlled-response-model",
		},
		RequestBody:  []byte(`{"messages":[{"role":"system","content":"` + secretSystem + `"},{"role":"user","content":"` + secretPrompt + `"}]}`),
		ResponseBody: []byte(`{"choices":[{"message":{"content":"` + secretCompletion + `"}}]}`),
	}
}

func TestStampInternalGenAI_OmitsPromptAndCompletionContent(t *testing.T) {
	span := stampedSpan(t, paramsWithBodies())

	for _, kv := range span.Attributes() {
		value := kv.Value.Emit()
		for _, secret := range []string{secretPrompt, secretCompletion, secretSystem} {
			assert.NotContains(t, value, secret,
				"attribute %q leaked message content onto the gateway's own span", kv.Key)
		}
		// Nothing should carry a raw JSON body either, whatever the key.
		assert.NotContains(t, value, `"messages"`,
			"attribute %q looks like a raw request body", kv.Key)
		assert.NotContains(t, value, `"choices"`,
			"attribute %q looks like a raw response body", kv.Key)
	}
}

func TestStampInternalGenAI_SetsNoForbiddenKey(t *testing.T) {
	span := stampedSpan(t, paramsWithBodies())

	present := make(map[string]struct{}, len(span.Attributes()))
	for _, kv := range span.Attributes() {
		present[string(kv.Key)] = struct{}{}
	}
	for _, forbidden := range ForbiddenInternalSpanAttrs {
		assert.NotContains(t, present, forbidden,
			"content-carrying key %q must never be stamped on internal telemetry", forbidden)
	}
}

// The other half of the requirement: we need the gateway traced, so the
// operational metadata must actually be there. A span stripped of content but
// also stripped of model and usage would be useless.
func TestStampInternalGenAI_KeepsOperationalMetadata(t *testing.T) {
	span := stampedSpan(t, paramsWithBodies())

	got := make(map[string]string, len(span.Attributes()))
	for _, kv := range span.Attributes() {
		got[string(kv.Key)] = kv.Value.Emit()
	}

	assert.Equal(t, "chat", got[AttrGenAIOperationName])
	assert.Equal(t, "openai", got[AttrGenAISystem])
	assert.Equal(t, "gpt-5-mini", got[AttrGenAIRequestModel])
	assert.NotContains(t, got, AttrGenAIResponseModel)
	assert.Equal(t, "120", got[AttrGenAIUsageIn])
	assert.Equal(t, "34", got[AttrGenAIUsageOut])
	assert.Equal(t, "154", got[AttrGenAIUsageTotal])
	assert.Equal(t, "vk-1", got[AttrVirtualKeyID])
	assert.Equal(t, "req-1", got[AttrGatewayReqID])
}

func TestStampInternalGenAI_OmitsUntrustedModelMetadata(t *testing.T) {
	const secret = "customer-secret-in-model-field"
	params := paramsWithBodies()
	params.Model = secret
	params.ProviderID = domain.ProviderID(secret)
	params.Usage.Model = secret
	params.InternalModel = ""
	params.InternalProviderID = ""

	span := stampedSpan(t, params)
	for _, kv := range span.Attributes() {
		assert.NotContains(t, kv.Value.Emit(), secret,
			"attribute %q leaked a customer-controlled model value", kv.Key)
	}
}

func TestStampInternalGenAI_RecordsUpstreamFailure(t *testing.T) {
	params := paramsWithBodies()
	params.UpstreamErrorType = "provider_timeout"
	params.UpstreamStatusCode = 504

	span := stampedSpan(t, params)

	got := make(map[string]string, len(span.Attributes()))
	for _, kv := range span.Attributes() {
		got[string(kv.Key)] = kv.Value.Emit()
	}
	assert.Equal(t, "provider_timeout", got[AttrErrorType])
	assert.Equal(t, "504", got[AttrUpstreamStatusCode])
}

// The classifier token is a fixed vocabulary, never raw provider text — the
// shape that let an Authorization header reach telemetry elsewhere.
func TestStampInternalGenAI_ErrorTypeCarriesNoProviderText(t *testing.T) {
	params := paramsWithBodies()
	params.UpstreamErrorType = "provider_error"

	span := stampedSpan(t, params)

	for _, kv := range span.Attributes() {
		if string(kv.Key) != AttrErrorType {
			continue
		}
		assert.NotContains(t, kv.Value.Emit(), " ",
			"error.type must stay a classifier token, not a message")
	}
}

// The content keys must not even exist as constants in this package: a
// declared key is one autocomplete away from being stamped.
func TestPackageDeclaresNoContentAttributeConstants(t *testing.T) {
	declared := []string{
		AttrGenAIOperationName, AttrGenAISystem, AttrGenAIRequestModel,
		AttrGenAIRequestTemp, AttrGenAIRequestMaxTokens, AttrGenAIRequestTopP,
		AttrGenAIRequestFreqPen, AttrGenAIRequestPresPen, AttrGenAIRequestStopSeqs,
		AttrGenAIResponseID, AttrGenAIResponseModel, AttrGenAIResponseFinish,
		AttrGenAIUsageIn, AttrGenAIUsageOut, AttrGenAIUsageTotal,
		AttrGenAIUsageCacheRead, AttrGenAIUsageCacheCreate, AttrGenAIConversationID,
	}
	for _, key := range declared {
		assert.NotContains(t, ForbiddenInternalSpanAttrs, key,
			"this package declares a content-carrying key: %q", key)
	}
}
