package langwatch

import (
	"encoding/base64"
	"os"
	"strings"
)

// patPrefix identifies Personal Access Tokens.
const patPrefix = "pat-lw-"

// IsPersonalAccessToken reports whether the supplied credential is a
// LangWatch Personal Access Token (prefixed with "pat-lw-").
func IsPersonalAccessToken(token string) bool {
	return strings.HasPrefix(token, patPrefix)
}

// buildAuthHeaders returns the HTTP headers required to authenticate
// against the LangWatch API.
//
// Two token families share the same surface:
//
//  1. sk-lw-* legacy project keys — the token itself carries project
//     identity, so we emit `Authorization: Bearer <token>` plus
//     `X-Auth-Token: <token>` for backwards compatibility with older
//     endpoints that only read the legacy header.
//
//  2. pat-lw-* Personal Access Tokens — user-owned and must be paired
//     with a projectID so the server can resolve the correct role
//     binding. When projectID is available, both are encoded as
//     `Authorization: Basic base64(projectID:token)` — the canonical
//     PAT carrier. Without a projectID, we fall back to Bearer +
//     X-Auth-Token so the server returns a clean 401 rather than
//     silently accepting an unresolvable request.
//
// When apiKey is empty, no auth headers are emitted.
func buildAuthHeaders(apiKey, projectID string) map[string]string {
	if apiKey == "" {
		return map[string]string{}
	}

	if projectID == "" {
		projectID = os.Getenv("LANGWATCH_PROJECT_ID")
	}

	if IsPersonalAccessToken(apiKey) && projectID != "" {
		credential := projectID + ":" + apiKey
		encoded := base64.StdEncoding.EncodeToString([]byte(credential))
		return map[string]string{
			"Authorization": "Basic " + encoded,
		}
	}

	// sk-lw-* or PAT without projectID: preserve dual-header shape.
	return map[string]string{
		"Authorization": "Bearer " + apiKey,
		"X-Auth-Token":  apiKey,
	}
}
