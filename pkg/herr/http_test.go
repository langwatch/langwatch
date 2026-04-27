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
