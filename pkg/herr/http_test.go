package herr

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBody_CarriesTypeAndCode(t *testing.T) {
	// Both are always emitted and always agree: `type` for OpenAI-compatible
	// consumers, `code` for everyone reading the TypeScript-side name.
	body := Body(New(context.Background(), Code("conversation_busy"), nil))
	assert.Equal(t, "conversation_busy", body.Type)
	assert.Equal(t, "conversation_busy", body.Code)

	// A writer that only set `type` still resolves to the same error.
	legacy := FromBody(ErrorBody{Type: "conversation_busy", Message: "conversation_busy"})
	assert.Equal(t, Code("conversation_busy"), legacy.Code)
	assert.NotContains(t, legacy.Meta, "message",
		"a message equal to the code must not be promoted into meta")
}

func TestWriteHTTP_ExposesMetaTraceAndReasons(t *testing.T) {
	RegisterStatus("chain_exhausted", http.StatusBadGateway)
	RegisterStatus("provider_error", http.StatusBadGateway)

	providerErr := New(context.Background(), "provider_error", M{"message": "server error", "status": 503})
	e := New(context.Background(), "chain_exhausted", M{"message": "all providers failed"}, providerErr)

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	assert.Equal(t, http.StatusBadGateway, rec.Code)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Equal(t, "chain_exhausted", resp.Error.Type)
	assert.Equal(t, "all providers failed", resp.Error.Message)

	require.Len(t, resp.Error.Reasons, 1)
	assert.Equal(t, "provider_error", resp.Error.Reasons[0].Type)
	assert.Equal(t, "server error", resp.Error.Reasons[0].Message)
	assert.InDelta(t, float64(503), resp.Error.Reasons[0].Meta["status"], 0)
}

func TestWriteHTTP_NonHerrReasonsBecomUnknown(t *testing.T) {
	RegisterStatus("test_err", http.StatusBadRequest)

	inner := errors.New("postgres: connection refused at 10.0.2.15:5432")
	e := New(context.Background(), "test_err", nil, inner)

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	require.Len(t, resp.Error.Reasons, 1)
	assert.Equal(t, "unknown", resp.Error.Reasons[0].Type)
	assert.Equal(t, "unknown", resp.Error.Reasons[0].Message)
	assert.NotContains(t, rec.Body.String(), "postgres")
	assert.NotContains(t, rec.Body.String(), "10.0.2.15")
}

func TestWriteHTTP_MetaMessagePromoted(t *testing.T) {
	RegisterStatus("blocked", http.StatusForbidden)

	e := New(context.Background(), "blocked", M{"message": "content policy violation", "policy": "pii"})

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Equal(t, "content policy violation", resp.Error.Message)
	assert.Equal(t, "pii", resp.Error.Meta["policy"])
	// "message" should not appear in Meta (promoted to top-level)
	_, hasMessage := resp.Error.Meta["message"]
	assert.False(t, hasMessage)
}

func TestWriteHTTP_FallsBackToCode(t *testing.T) {
	RegisterStatus("unknown_thing", http.StatusInternalServerError)

	e := New(context.Background(), "unknown_thing", nil)

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Equal(t, "unknown_thing", resp.Error.Message)
	assert.Nil(t, resp.Error.Meta)
	assert.Empty(t, resp.Error.Reasons)
}

func TestWriteHTTP_NonHerrError(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteHTTP(rec, errors.New("raw stdlib error with internal IP 192.168.1.1"))

	assert.Equal(t, http.StatusInternalServerError, rec.Code)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "unknown", resp.Error.Type)
	assert.Equal(t, "unknown", resp.Error.Message)
	assert.NotContains(t, rec.Body.String(), "192.168.1.1")
}

// Body/FromBody carry a typed error across non-HTTP wires (frame relays,
// queues). The contract: a round trip preserves code, message, meta, trace
// ids, and the reasons chain — so `tree_zebra` in service A is `tree_zebra`
// in service B — while stacks never cross and non-herr reasons stay collapsed
// to "unknown".
func TestBodyFromBody_RoundTripsTypedChain(t *testing.T) {
	ctx := context.Background()
	inner := New(ctx, "no_provider_configured", M{
		"message":     "no model provider configured",
		"http_status": 400,
	})
	outer := New(ctx, "agent_error", M{"message": "the agent hit an error"},
		inner, errors.New("raw internal detail"))

	body := Body(outer)

	assert.Equal(t, "agent_error", body.Type)
	assert.Equal(t, "the agent hit an error", body.Message)
	require.Len(t, body.Reasons, 2)
	assert.Equal(t, "no_provider_configured", body.Reasons[0].Type)
	assert.Equal(t, "no model provider configured", body.Reasons[0].Message)
	assert.Equal(t, "unknown", body.Reasons[1].Type)

	// Simulate the wire: encode/decode the envelope, then reconstruct.
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "raw internal detail")
	var decoded ErrorBody
	require.NoError(t, json.Unmarshal(raw, &decoded))

	e := FromBody(decoded)
	assert.True(t, IsCode(e, "agent_error"))
	require.Len(t, e.Reasons, 2)
	assert.True(t, IsCode(e.Reasons[0], "no_provider_configured"))
	assert.True(t, IsCode(e.Reasons[1], "unknown"))

	// Re-serializing the reconstruction is lossless: same envelope again
	// (message re-promoted from Meta["message"], meta preserved).
	again := Body(e)
	assert.Equal(t, "the agent hit an error", again.Message)
	assert.Equal(t, "no model provider configured", again.Reasons[0].Message)
	// json numbers decode to float64; compare loosely.
	assert.EqualValues(t, 400, again.Reasons[0].Meta["http_status"])
}

func TestFromBody_ParsesTraceIDsAndTolerantOfGarbage(t *testing.T) {
	e := FromBody(ErrorBody{
		Type:    "agent_error",
		Message: "boom",
		TraceID: "0af7651916cd43dd8448eb211c80319c",
		SpanID:  "b7ad6b7169203331",
	})
	assert.Equal(t, "0af7651916cd43dd8448eb211c80319c", e.TraceID.String())
	assert.Equal(t, "b7ad6b7169203331", e.SpanID.String())
	assert.Equal(t, "boom", e.Meta["message"])

	// Unparseable ids must not error — they just don't survive.
	g := FromBody(ErrorBody{Type: "agent_error", TraceID: "zzz", SpanID: "!"})
	assert.False(t, g.TraceID.IsValid())
	assert.False(t, g.SpanID.IsValid())
	// A message equal to the type is the toErrorBody default, not real
	// content — FromBody must not stuff it into Meta.
	h := FromBody(ErrorBody{Type: "agent_error", Message: "agent_error"})
	_, hasMessage := h.Meta["message"]
	assert.False(t, hasMessage)
}

func TestBody_NonHerrErrorCollapsesToUnknown(t *testing.T) {
	body := Body(errors.New("secret internal path /srv/x"))
	assert.Equal(t, "unknown", body.Type)
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "/srv/x")
}

func TestWriteHTTP_TipsDocsURLFaultPromoted(t *testing.T) {
	RegisterStatus("rate_limited", http.StatusTooManyRequests)

	e := New(context.Background(), "rate_limited", M{
		"message":  "rate limit exceeded",
		"tips":     []string{"retry with backoff", "reduce request concurrency"},
		"docs_url": "https://docs.example.com/rate-limits",
		"fault":    "customer",
		"limit":    100,
	})

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	raw := rec.Body.String()
	var resp ErrorResponse
	require.NoError(t, json.Unmarshal([]byte(raw), &resp))

	assert.Equal(t, []string{"retry with backoff", "reduce request concurrency"}, resp.Error.Tips)
	assert.Equal(t, "https://docs.example.com/rate-limits", resp.Error.DocsURL)
	assert.Equal(t, "customer", resp.Error.Fault)
	assert.EqualValues(t, 100, resp.Error.Meta["limit"])
	// Promoted keys should not appear in Meta.
	_, hasTips := resp.Error.Meta["tips"]
	assert.False(t, hasTips)
	_, hasDocsURL := resp.Error.Meta["docs_url"]
	assert.False(t, hasDocsURL)
	_, hasFault := resp.Error.Meta["fault"]
	assert.False(t, hasFault)

	// Wire shape: tips/docs_url/fault are top-level fields.
	assert.Contains(t, raw, `"tips":["retry with backoff","reduce request concurrency"]`)
	assert.Contains(t, raw, `"docs_url":"https://docs.example.com/rate-limits"`)
	assert.Contains(t, raw, `"fault":"customer"`)
}

func TestWriteHTTP_TipsFromAnySlice(t *testing.T) {
	RegisterStatus("tips_any", http.StatusBadRequest)

	// Meta is map[string]any; a decoded []any of strings must promote too.
	e := New(context.Background(), "tips_any", M{"tips": []any{"first", "second", 42, ""}})

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Equal(t, []string{"first", "second"}, resp.Error.Tips)
	_, hasTips := resp.Error.Meta["tips"]
	assert.False(t, hasTips)
}

func TestWriteHTTP_NoTipsDocsURLFaultWhenAbsent(t *testing.T) {
	RegisterStatus("plain_err", http.StatusBadRequest)

	e := New(context.Background(), "plain_err", M{"message": "boom", "policy": "pii"})

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Nil(t, resp.Error.Tips)
	assert.Empty(t, resp.Error.DocsURL)
	assert.Empty(t, resp.Error.Fault)
	raw := rec.Body.String()
	assert.NotContains(t, raw, "tips")
	assert.NotContains(t, raw, "docs_url")
	assert.NotContains(t, raw, "fault")
}

func TestBodyFromBody_RoundTripsTipsDocsURLFault(t *testing.T) {
	ctx := context.Background()
	inner := New(ctx, "provider_error", M{
		"message":  "provider rejected the request",
		"tips":     []string{"check provider credentials"},
		"docs_url": "https://docs.example.com/providers",
	})
	outer := New(ctx, "agent_error", M{
		"message":  "the agent hit an error",
		"fault":    "platform",
		"tips":     []string{"retry the run", "contact support if it persists"},
		"docs_url": "https://docs.example.com/agent-errors",
	}, inner)

	body := Body(outer)

	assert.Equal(t, []string{"retry the run", "contact support if it persists"}, body.Tips)
	assert.Equal(t, "https://docs.example.com/agent-errors", body.DocsURL)
	assert.Equal(t, "platform", body.Fault)

	// Nested reasons go through the same path and keep their own values.
	require.Len(t, body.Reasons, 1)
	assert.Equal(t, []string{"check provider credentials"}, body.Reasons[0].Tips)
	assert.Equal(t, "https://docs.example.com/providers", body.Reasons[0].DocsURL)
	assert.Empty(t, body.Reasons[0].Fault)

	// Simulate the wire, then reconstruct.
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	var decoded ErrorBody
	require.NoError(t, json.Unmarshal(raw, &decoded))

	e := FromBody(decoded)
	assert.True(t, IsCode(e, "agent_error"))
	assert.Equal(t, "platform", e.Meta["fault"])
	assert.Equal(t, "https://docs.example.com/agent-errors", e.Meta["docs_url"])

	// Re-serializing the reconstruction is lossless: same envelope again.
	again := Body(e)
	assert.Equal(t, body, again)
}

func TestWriteHTTP_InvalidFaultDropped(t *testing.T) {
	RegisterStatus("faulty", http.StatusBadRequest)

	// A typo'd fault must not reach the wire — the TS side parses only the
	// three contract values.
	e := New(context.Background(), "faulty", M{"message": "boom", "fault": "custmer"})

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Empty(t, resp.Error.Fault)
	assert.NotContains(t, rec.Body.String(), "custmer")
}
