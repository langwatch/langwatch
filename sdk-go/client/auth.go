package client

import (
	"encoding/base64"
	"os"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// buildAuthHeaders returns the HTTP headers required to authenticate against the
// LangWatch API for the given credential and project.
//
// It reproduces, byte-for-byte, the behaviour of the core SDK's unexported
// buildAuthHeaders (github.com/langwatch/langwatch/sdk-go) so the API client and
// the trace exporter authenticate identically. The PAT-detection rule is reused
// directly from the core via [langwatch.IsPersonalAccessToken], keeping that one
// decision single-sourced even though the header assembly itself must be
// duplicated (the core function is package-private).
//
// Two credential families share one surface:
//
//  1. sk-lw-* legacy project keys carry project identity in the token itself, so
//     the client emits Authorization: Bearer <token> plus X-Auth-Token: <token>
//     for backwards compatibility with endpoints that only read the legacy
//     header.
//
//  2. pat-lw-* Personal Access Tokens are user-owned and must be paired with a
//     projectID. When projectID is available, both are encoded as
//     Authorization: Basic base64(projectID:token). Without a projectID the
//     client falls back to Bearer + X-Auth-Token so the server returns a clean
//     401 rather than silently accepting an unresolvable request.
//
// When apiKey is empty no auth headers are emitted, mirroring the core SDK.
func buildAuthHeaders(apiKey, projectID string) map[string]string {
	if apiKey == "" {
		return map[string]string{}
	}

	if projectID == "" {
		projectID = os.Getenv("LANGWATCH_PROJECT_ID")
	}

	if langwatch.IsPersonalAccessToken(apiKey) && projectID != "" {
		credential := projectID + ":" + apiKey
		encoded := base64.StdEncoding.EncodeToString([]byte(credential))
		return map[string]string{
			"Authorization": "Basic " + encoded,
		}
	}

	return map[string]string{
		"Authorization": "Bearer " + apiKey,
		"X-Auth-Token":  apiKey,
	}
}
