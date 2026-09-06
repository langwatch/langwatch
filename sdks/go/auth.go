package langwatch

import (
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

// buildAuthHeaders returns the HTTP headers required to authenticate against the
// LangWatch API. The credential is always carried as `Authorization: Bearer
// <token>`, and the project is identified with the `X-Project-Id` header when
// known. Both token families use the same shape:
//
//   - sk-lw-* project keys carry project identity themselves, so X-Project-Id is
//     optional — it pins the request to a specific project when supplied.
//
//   - pat-lw-* Personal Access Tokens are user-owned and require X-Project-Id so
//     the server can resolve the correct role binding.
//
// projectID falls back to $LANGWATCH_PROJECT_ID. When apiKey is empty, no auth
// headers are emitted.
func buildAuthHeaders(apiKey, projectID string) map[string]string {
	if apiKey == "" {
		return map[string]string{}
	}

	if projectID == "" {
		projectID = os.Getenv("LANGWATCH_PROJECT_ID")
	}

	headers := map[string]string{
		"Authorization": "Bearer " + apiKey,
	}
	if projectID != "" {
		headers["X-Project-Id"] = projectID
	}
	return headers
}
