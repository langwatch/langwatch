package client

import "os"

// buildAuthHeaders returns the HTTP headers required to authenticate against the
// LangWatch API for the given credential and project. The credential is carried
// as Authorization: Bearer <token>, and the project is identified with the
// X-Project-Id header when known — mirroring the core SDK's trace exporter so the
// API client and the exporter authenticate identically.
//
//   - sk-lw-* project keys carry project identity in the token itself, so
//     X-Project-Id is optional (it pins the request to a specific project).
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
