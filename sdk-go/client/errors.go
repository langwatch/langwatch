package client

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// APIError is returned by every service method when the LangWatch API responds
// with a non-2xx status. It captures everything needed to diagnose or branch on
// the failure: the HTTP status, the human-readable message decoded from the
// response body, the logical operation that failed, and the raw body bytes for
// cases the decoder did not anticipate.
//
// Branch on it with [errors.As], or use the [IsNotFound], [IsUnauthorized] and
// [IsConflict] helpers for the common cases.
//
//	var apiErr *client.APIError
//	if errors.As(err, &apiErr) {
//		log.Printf("LangWatch %s failed: %d %s", apiErr.Operation, apiErr.StatusCode, apiErr.Message)
//	}
type APIError struct {
	// StatusCode is the HTTP status code returned by the API (e.g. 404).
	StatusCode int

	// Status is the HTTP status text (e.g. "404 Not Found").
	Status string

	// Message is the best human-readable explanation extracted from the
	// response body. The LangWatch API is not perfectly consistent about its
	// error envelope, so this is resolved by trying, in order: a top-level
	// "message" field, a string "error" field, then "detail"/"reason", and
	// finally falling back to the HTTP status text.
	Message string

	// Operation names the SDK method that produced the error, e.g.
	// "Prompts.Get". It mirrors the per-operation error labelling in the
	// TypeScript SDK and makes log lines self-describing.
	Operation string

	// Body is the raw, undecoded response body. It is retained so callers can
	// recover details the standard decoder did not surface.
	Body []byte
}

// Error implements the error interface, producing a message of the form
// "langwatch: <Operation> failed: <StatusCode> <Message>".
func (e *APIError) Error() string {
	if e.Operation != "" {
		return fmt.Sprintf("langwatch: %s failed: %d %s", e.Operation, e.StatusCode, e.Message)
	}
	return fmt.Sprintf("langwatch: request failed: %d %s", e.StatusCode, e.Message)
}

// newAPIError builds an APIError from a raw HTTP status and response body,
// decoding the message with the same field-priority logic the TypeScript SDK
// uses. It tolerates both of LangWatch's error-body shapes: the component
// schema where "error" is an integer code with a separate "message", and the
// inline route shape where "error" is itself the message string.
func newAPIError(operation string, statusCode int, status string, body []byte) *APIError {
	return &APIError{
		StatusCode: statusCode,
		Status:     status,
		Message:    extractErrorMessage(body, status),
		Operation:  operation,
		Body:       body,
	}
}

// errorBody is a permissive view over LangWatch error payloads. "error" is
// decoded as raw JSON because it is a string on the inline routes (prompts,
// datasets, …) but an integer code on the shared component schema.
type errorBody struct {
	Message *string         `json:"message"`
	Error   json.RawMessage `json:"error"`
	Detail  *string         `json:"detail"`
	Reason  *string         `json:"reason"`
}

// extractErrorMessage pulls the most useful message out of an error body,
// falling back to fallback (typically the HTTP status text) when nothing usable
// is present.
func extractErrorMessage(body []byte, fallback string) string {
	if len(body) == 0 {
		return fallback
	}

	var parsed errorBody
	if err := json.Unmarshal(body, &parsed); err == nil {
		if parsed.Message != nil && *parsed.Message != "" {
			return *parsed.Message
		}
		if s := errorFieldAsString(parsed.Error); s != "" {
			return s
		}
		if parsed.Detail != nil && *parsed.Detail != "" {
			return *parsed.Detail
		}
		if parsed.Reason != nil && *parsed.Reason != "" {
			return *parsed.Reason
		}
	}

	// Couldn't parse a known shape: surface the raw body if it is short enough
	// to be a message rather than a payload dump, otherwise the status text.
	if trimmed := string(body); len(trimmed) > 0 && len(trimmed) <= 512 {
		return trimmed
	}
	return fallback
}

// errorFieldAsString interprets the "error" field as a message only when it is a
// JSON string. Integer codes (the component-schema shape) are ignored here so
// the message resolution can fall through to other fields.
func errorFieldAsString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return ""
}

// statusErr is a sentinel returned for a given HTTP status, used only by the
// Is* helpers via [errors.As] matching on the APIError's StatusCode. It is not
// itself returned to callers.

// IsNotFound reports whether err is an [*APIError] with HTTP status 404.
func IsNotFound(err error) bool { return hasStatus(err, http.StatusNotFound) }

// IsUnauthorized reports whether err is an [*APIError] with HTTP status 401.
func IsUnauthorized(err error) bool { return hasStatus(err, http.StatusUnauthorized) }

// IsConflict reports whether err is an [*APIError] with HTTP status 409.
func IsConflict(err error) bool { return hasStatus(err, http.StatusConflict) }

// hasStatus reports whether err unwraps to an [*APIError] carrying the given
// HTTP status code.
func hasStatus(err error, code int) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.StatusCode == code
}
