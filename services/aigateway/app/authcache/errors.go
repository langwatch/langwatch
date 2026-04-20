package authcache

import "github.com/langwatch/langwatch/pkg/herr"

// Error codes for auth failures.
var (
	ErrInvalidKey = herr.Code("invalid_api_key")
	ErrKeyRevoked = herr.Code("virtual_key_revoked")
	ErrUpstream   = herr.Code("auth_upstream_unavailable")
)
