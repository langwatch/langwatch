package domain

import "github.com/langwatch/langwatch/pkg/herr"

// The refusals of the HMAC-signed internal channel, one code each so a
// caller can tell a clock problem from a wrong secret.
var (
	// ErrMissingSignature means the signature or timestamp header is absent.
	ErrMissingSignature = herr.Code("missing_signature")
	// ErrInvalidSignature means the signature does not match the request.
	ErrInvalidSignature = herr.Code("invalid_signature")
	// ErrInvalidTimestamp means the timestamp header is not unix seconds.
	ErrInvalidTimestamp = herr.Code("invalid_timestamp")
	// ErrTimestampOutOfWindow means the signed timestamp is outside the
	// replay window.
	ErrTimestampOutOfWindow = herr.Code("timestamp_out_of_window")
)
