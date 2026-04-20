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

func TestWriteHTTP_UsesMetaReasonNotInternalError(t *testing.T) {
	RegisterStatus("test_error", http.StatusBadRequest)

	// Create an error with a wrapped reason that contains internal details
	inner := errors.New("postgres: connection refused at 10.0.2.15:5432")
	e := New(context.Background(), "test_error", M{"reason": "service unavailable"}, inner)

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	// Client-facing message should be the safe "reason", not the internal error chain
	assert.Equal(t, "service unavailable", resp.Error.Message)
	assert.NotContains(t, resp.Error.Message, "postgres")
	assert.NotContains(t, resp.Error.Message, "10.0.2.15")
}

func TestWriteHTTP_FallsBackToMetaMessage(t *testing.T) {
	RegisterStatus("blocked", http.StatusForbidden)

	e := New(context.Background(), "blocked", M{"message": "content policy violation"})

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "content policy violation", resp.Error.Message)
}

func TestWriteHTTP_FallsBackToCode(t *testing.T) {
	RegisterStatus("unknown_thing", http.StatusInternalServerError)

	e := New(context.Background(), "unknown_thing", nil, errors.New("secret internal detail"))

	rec := httptest.NewRecorder()
	WriteHTTP(rec, e)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	// No meta reason/message → falls back to code name, not internal error
	assert.Equal(t, "unknown_thing", resp.Error.Message)
	assert.NotContains(t, resp.Error.Message, "secret internal detail")
}

func TestWriteHTTP_NonHerrError(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteHTTP(rec, errors.New("raw stdlib error with internal IP 192.168.1.1"))

	assert.Equal(t, http.StatusInternalServerError, rec.Code)

	var resp ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "unknown", resp.Error.Type)
	// Should NOT leak the raw error message
	assert.Equal(t, "unknown", resp.Error.Message)
}
