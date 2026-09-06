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

// End-user attribution on the customer span: the middleware-lifted header id
// wins, the OpenAI `user` body param is the fallback on the request shapes
// that carry one, and both sources sanitize identically. The trace fold reads
// exactly langwatch.end_user_id into per-request spend events; the metadata
// echo rides langwatch.reserved.request_metadata the same way.
//
// Spec: specs/ai-gateway/billing-spend-events.feature

// recordSpanForParamsCtx is recordSpanForParams with caller-controlled
// context values (end-user id, metadata echo) applied before EndSpan.
func recordSpanForParamsCtx(
	t *testing.T,
	wrap func(context.Context) context.Context,
	params domain.AITraceParams,
) sdktrace.ReadOnlySpan {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	e := &Emitter{tp: tp, tracer: tp.Tracer("test"), propagator: propagation.TraceContext{}}

	ctx, _ := e.BeginSpan(wrap(context.Background()), "proj-test", params.RequestType)
	e.EndSpan(ctx, params)

	spans := sr.Ended()
	require.Len(t, spans, 1)
	return spans[0]
}

// @scenario "A header-declared end user wins over the body user param"
func TestEmitter_EndUser_HeaderWinsOverBodyParam(t *testing.T) {
	span := recordSpanForParamsCtx(t,
		func(ctx context.Context) context.Context {
			return WithEndUserID(ctx, "header-user")
		},
		domain.AITraceParams{
			ProviderID:  domain.ProviderOpenAI,
			Model:       "gpt-5",
			RequestType: domain.RequestTypeChat,
			RequestBody: []byte(`{"model":"gpt-5","user":"body-user"}`),
			Usage:       domain.Usage{CompletionTokens: 3},
		})

	got, ok := hasStringAttr(span, AttrEndUserID)
	require.True(t, ok, "span must carry langwatch.end_user_id")
	assert.Equal(t, "header-user", got)
}

// @scenario "The OpenAI user body param attributes the request when no header is sent"
func TestEmitter_EndUser_BodyParamFallback(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:  domain.ProviderOpenAI,
		Model:       "gpt-5",
		RequestType: domain.RequestTypeChat,
		RequestBody: []byte(`{"model":"gpt-5","user":"acme-user-42"}`),
		Usage:       domain.Usage{CompletionTokens: 3},
	})

	got, ok := hasStringAttr(span, AttrEndUserID)
	require.True(t, ok)
	assert.Equal(t, "acme-user-42", got)
}

// @scenario "Request shapes without a user param stamp nothing without a header"
func TestEmitter_EndUser_MessagesShapeHasNoBodyFallback(t *testing.T) {
	// Anthropic-wire metadata.user_id is a session carrier for claude-code,
	// not end-user attribution; only the headers attribute this shape.
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:  domain.ProviderAnthropic,
		Model:       "claude-sonnet-5",
		RequestType: domain.RequestTypeMessages,
		RequestBody: []byte(`{"model":"claude-sonnet-5","metadata":{"user_id":"not-attribution"}}`),
		Usage:       domain.Usage{CompletionTokens: 3},
	})

	_, ok := hasStringAttr(span, AttrEndUserID)
	assert.False(t, ok, "messages shape must not infer an end user from the body")
}

// @scenario "A request with no end user carries no attribution attribute"
func TestEmitter_EndUser_AbsentWhenNoSource(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:  domain.ProviderOpenAI,
		Model:       "gpt-5",
		RequestType: domain.RequestTypeChat,
		RequestBody: []byte(`{"model":"gpt-5"}`),
		Usage:       domain.Usage{CompletionTokens: 3},
	})

	_, ok := hasStringAttr(span, AttrEndUserID)
	assert.False(t, ok)
}

// @scenario "The body user param is sanitized like the headers"
func TestEmitter_EndUser_BodyParamSanitized(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:  domain.ProviderOpenAI,
		Model:       "gpt-5",
		RequestType: domain.RequestTypeChat,
		RequestBody: []byte("{\"model\":\"gpt-5\",\"user\":\"  evil\\u0000\\u0007user  \"}"),
		Usage:       domain.Usage{CompletionTokens: 3},
	})

	got, ok := hasStringAttr(span, AttrEndUserID)
	require.True(t, ok)
	assert.Equal(t, "eviluser", got)
}

// @scenario "The metadata echo is stamped verbatim on the customer span"
func TestEmitter_RequestMetadata_Stamped(t *testing.T) {
	echo := `{"org_id":"acme-1","team_id":"t-9"}`
	span := recordSpanForParamsCtx(t,
		func(ctx context.Context) context.Context {
			return WithRequestMetadataJSON(ctx, echo)
		},
		domain.AITraceParams{
			ProviderID:  domain.ProviderOpenAI,
			Model:       "gpt-5",
			RequestType: domain.RequestTypeChat,
			Usage:       domain.Usage{CompletionTokens: 3},
		})

	got, ok := hasStringAttr(span, AttrRequestMetadata)
	require.True(t, ok, "span must carry langwatch.reserved.request_metadata")
	assert.Equal(t, echo, got)
}

// @scenario "No metadata header means no reserved metadata attribute"
func TestEmitter_RequestMetadata_AbsentByDefault(t *testing.T) {
	span := recordSpanForParams(t, domain.AITraceParams{
		ProviderID:  domain.ProviderOpenAI,
		Model:       "gpt-5",
		RequestType: domain.RequestTypeChat,
		Usage:       domain.Usage{CompletionTokens: 3},
	})

	_, ok := hasStringAttr(span, AttrRequestMetadata)
	assert.False(t, ok)
}

func TestSanitizeEndUserID(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "user-123", "user-123"},
		{"trimmed", "  user-123  ", "user-123"},
		{"control chars stripped", "a\x00b\x1fc\x7fd", "abcd"},
		{"only controls yields empty", "\x00\x01\x02", ""},
		{"empty", "", ""},
		{"capped at 256 runes", strings.Repeat("x", 300), strings.Repeat("x", 256)},
		{"multibyte runes cap by rune", strings.Repeat("é", 300), strings.Repeat("é", 256)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, SanitizeEndUserID(tc.in))
		})
	}
}

func TestValidateRequestMetadataJSON(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"valid object", `{"a":1}`, `{"a":1}`},
		{"valid object with whitespace", `  {"a":1}  `, `{"a":1}`},
		{"array rejected", `[1,2]`, ""},
		{"scalar rejected", `"str"`, ""},
		{"invalid json rejected", `{"a":`, ""},
		{"empty", "", ""},
		{"oversized rejected", `{"k":"` + strings.Repeat("v", 4096) + `"}`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ValidateRequestMetadataJSON(tc.in))
		})
	}
}
