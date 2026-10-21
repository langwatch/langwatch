package langwatch

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/baggage"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

// Pinned identically in the TypeScript and Python SDK tests (ADR-183 section 4).
const (
	braidTestSigningKey = "lwsk_testkid_testsecret"
	braidTestTraceID    = "0af7651916cd43dd8448eb211c80319c"
	braidPinnedSig      = "eyJ2IjoxLCJraWQiOiJ0ZXN0a2lkIiwia2V5cyI6WyJvcmNoZXN0cmF0b3IiLCJ0ZWFtIl0sInNpZyI6IjFNWGtzUVIzc25vdVBZV0Z4TzVDZnlyRzY2WUQ1MzlhbmNlbWVRaG9VazQifQ"
)

var braidTestEntries = map[string]string{"orchestrator": "web", "team": "a"}

func braidContextInTrace(t *testing.T) context.Context {
	t.Helper()
	traceID, err := trace.TraceIDFromHex(braidTestTraceID)
	require.NoError(t, err)
	spanID, err := trace.SpanIDFromHex("b7ad6b7169203331")
	require.NoError(t, err)
	sc := trace.NewSpanContext(trace.SpanContextConfig{TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled, Remote: true})
	return trace.ContextWithRemoteSpanContext(context.Background(), sc)
}

func braidErrorCode(err error) BraidSigningErrorCode {
	var signingErr *BraidSigningError
	if errors.As(err, &signingErr) {
		return signingErr.Code
	}
	return ""
}

func braidStartSpanUnder(t *testing.T, ctx context.Context, copyEntries ...string) map[string]string {
	t.Helper()
	processor, err := NewBraidBaggageSpanProcessor(copyEntries...)
	require.NoError(t, err)
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(processor),
		sdktrace.WithSyncer(exporter),
	)
	_, span := provider.Tracer("braids-test").Start(ctx, "called")
	span.End()
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, braidTestTraceID, spans[0].SpanContext.TraceID().String())
	attrs := map[string]string{}
	for _, kv := range spans[0].Attributes {
		if kv.Value.Type() == attribute.STRING {
			attrs[string(kv.Key)] = kv.Value.AsString()
		}
	}
	return attrs
}

func TestBraidPinnedVectorProducesTheSharedSignature(t *testing.T) {
	signature, err := ComputeBraidSignature(braidTestSigningKey, braidTestTraceID, map[string]string{"team": "a", "orchestrator": "web"})
	require.NoError(t, err)
	assert.Equal(t, braidPinnedSig, signature)

	raw, err := base64.RawURLEncoding.DecodeString(signature)
	require.NoError(t, err)
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(raw, &envelope))
	assert.Equal(t, map[string]any{
		"v":    float64(1),
		"kid":  "testkid",
		"keys": []any{"orchestrator", "team"},
		"sig":  "1MXksQR3snouPYWFxO5CfyrG66YD539ancemeQhoUk4",
	}, envelope)
}

func TestBraidSigningPutsEachEntryAndTheSignatureInBaggage(t *testing.T) {
	ctx, err := SignBaggage(braidContextInTrace(t), braidTestSigningKey, braidTestEntries)
	require.NoError(t, err)
	bag := baggage.FromContext(ctx)
	assert.Equal(t, "web", bag.Member("orchestrator").Value())
	assert.Equal(t, "a", bag.Member("team").Value())
	assert.Equal(t, braidPinnedSig, bag.Member(BraidSignatureKey).Value())
}

func TestBraidSigningRefusals(t *testing.T) {
	for _, key := range []string{"not-a-key", "lwsk_", "lwsk_kid", "lwsk__secret", "lwsk_kid_", "lwsk_k-id_secret", "lwsk_k.id_secret", "lwsk_kïd_secret"} {
		_, err := SignBaggage(braidContextInTrace(t), key, braidTestEntries)
		assert.Equal(t, BraidErrMalformedSigningKey, braidErrorCode(err), key)
	}
	for _, key := range []string{"bad key", "", strings.Repeat("x", 129), "é", BraidSignatureKey} {
		_, err := SignBaggage(braidContextInTrace(t), braidTestSigningKey, map[string]string{key: "v"})
		assert.Equal(t, BraidErrInvalidEntryKey, braidErrorCode(err), key)
	}
	for _, value := range []string{"x\nteam=a", "x\r", "\n"} {
		_, err := SignBaggage(braidContextInTrace(t), braidTestSigningKey, map[string]string{"orchestrator": value})
		assert.Equal(t, BraidErrInvalidEntryValue, braidErrorCode(err), value)
	}
	_, err := SignBaggage(braidContextInTrace(t), braidTestSigningKey, map[string]string{})
	assert.Equal(t, BraidErrEmptyEntries, braidErrorCode(err))

	_, err = SignBaggage(context.Background(), braidTestSigningKey, braidTestEntries)
	assert.Equal(t, BraidErrNoActiveTrace, braidErrorCode(err))

	_, err = NewBraidBaggageSpanProcessor("bad key")
	assert.Equal(t, BraidErrInvalidEntryKey, braidErrorCode(err))
}

func TestBraidSpanUnderSignedBaggageCarriesTheEntriesAndTheSignature(t *testing.T) {
	ctx, err := SignBaggage(braidContextInTrace(t), braidTestSigningKey, braidTestEntries)
	require.NoError(t, err)
	attrs := braidStartSpanUnder(t, ctx, "orchestrator", "team")
	assert.Equal(t, "web", attrs["orchestrator"])
	assert.Equal(t, "a", attrs["team"])
	assert.Equal(t, braidPinnedSig, attrs[BraidSignatureKey])
}

func TestBraidEntriesNotNamedStayOffTheSpan(t *testing.T) {
	orchestrator, err := baggage.NewMemberRaw("orchestrator", "web")
	require.NoError(t, err)
	other, err := baggage.NewMemberRaw("secretish", "x")
	require.NoError(t, err)
	bag, err := baggage.New(orchestrator, other)
	require.NoError(t, err)
	attrs := braidStartSpanUnder(t, baggage.ContextWithBaggage(braidContextInTrace(t), bag), "orchestrator")
	assert.Equal(t, "web", attrs["orchestrator"])
	assert.NotContains(t, attrs, "secretish")
}
