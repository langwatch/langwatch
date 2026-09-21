package client

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestExtractErrorMessage(t *testing.T) {
	t.Run("given a body with a message field", func(t *testing.T) {
		msg := extractErrorMessage([]byte(`{"message":"not allowed"}`), "fallback")
		assert.Equal(t, "not allowed", msg)
	})

	t.Run("given a body where error is a string (inline route shape)", func(t *testing.T) {
		msg := extractErrorMessage([]byte(`{"error":"Prompt not found"}`), "fallback")
		assert.Equal(t, "Prompt not found", msg)
	})

	t.Run("given a body where error is an int and message is present (component shape)", func(t *testing.T) {
		msg := extractErrorMessage([]byte(`{"error":404,"message":"Not Found"}`), "fallback")
		assert.Equal(t, "Not Found", msg, "integer error code is ignored in favour of message")
	})

	t.Run("given a body with only detail", func(t *testing.T) {
		msg := extractErrorMessage([]byte(`{"detail":"validation failed"}`), "fallback")
		assert.Equal(t, "validation failed", msg)
	})

	t.Run("given an empty body", func(t *testing.T) {
		msg := extractErrorMessage(nil, "404 Not Found")
		assert.Equal(t, "404 Not Found", msg)
	})

	t.Run("given an unparseable short body", func(t *testing.T) {
		msg := extractErrorMessage([]byte("plain text error"), "fallback")
		assert.Equal(t, "plain text error", msg)
	})
}

func TestAPIErrorBehaviour(t *testing.T) {
	t.Run("given an APIError", func(t *testing.T) {
		err := newAPIError("Prompts.Get", http.StatusNotFound, "404 Not Found", []byte(`{"error":"Prompt not found"}`))

		t.Run("when read", func(t *testing.T) {
			assert.Equal(t, http.StatusNotFound, err.StatusCode)
			assert.Equal(t, "Prompts.Get", err.Operation)
			assert.Equal(t, "Prompt not found", err.Message)
			assert.Contains(t, err.Error(), "Prompts.Get")
			assert.Contains(t, err.Error(), "404")
		})

		t.Run("when matched with errors.As", func(t *testing.T) {
			var apiErr *APIError
			assert.True(t, errors.As(error(err), &apiErr))
		})
	})

	t.Run("given helpers", func(t *testing.T) {
		assert.True(t, IsNotFound(newAPIError("op", 404, "", nil)))
		assert.True(t, IsUnauthorized(newAPIError("op", 401, "", nil)))
		assert.True(t, IsConflict(newAPIError("op", 409, "", nil)))
		assert.False(t, IsNotFound(newAPIError("op", 500, "", nil)))
		assert.False(t, IsNotFound(errors.New("plain")))
	})
}
