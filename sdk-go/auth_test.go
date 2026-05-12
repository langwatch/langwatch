package langwatch

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsPersonalAccessToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
		want  bool
	}{
		{"pat prefix is recognised", "pat-lw-abc_secret", true},
		{"legacy key is not a PAT", "sk-lw-legacy", false},
		{"empty string is not a PAT", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, IsPersonalAccessToken(tc.token))
		})
	}
}

func TestBuildAuthHeaders_EmptyApiKey(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "")
	assert.Empty(t, buildAuthHeaders("", ""))
}

func TestBuildAuthHeaders_LegacyKey(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "")
	headers := buildAuthHeaders("sk-lw-legacy", "")

	assert.Equal(t, "Bearer sk-lw-legacy", headers["Authorization"])
	assert.Equal(t, "sk-lw-legacy", headers["X-Auth-Token"])
}

func TestBuildAuthHeaders_PATWithExplicitProjectID(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "")
	headers := buildAuthHeaders("pat-lw-abc_secret", "project_123")

	expected := base64.StdEncoding.EncodeToString([]byte("project_123:pat-lw-abc_secret"))
	assert.Equal(t, "Basic "+expected, headers["Authorization"])
	assert.Empty(t, headers["X-Auth-Token"], "PATs with Basic Auth must not also emit the legacy header")
}

func TestBuildAuthHeaders_PATUsesEnvProjectID(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "env_project")
	headers := buildAuthHeaders("pat-lw-envtok", "")

	expected := base64.StdEncoding.EncodeToString([]byte("env_project:pat-lw-envtok"))
	assert.Equal(t, "Basic "+expected, headers["Authorization"])
}

func TestBuildAuthHeaders_PATFallsBackToBearerWithoutProjectID(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "")
	headers := buildAuthHeaders("pat-lw-nopid", "")

	assert.Equal(t, "Bearer pat-lw-nopid", headers["Authorization"])
	assert.Equal(t, "pat-lw-nopid", headers["X-Auth-Token"])
}
