package langwatch

import (
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

func TestBuildAuthHeaders_KeyWithoutProjectID(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "")
	headers := buildAuthHeaders("sk-lw-legacy", "")

	assert.Equal(t, "Bearer sk-lw-legacy", headers["Authorization"])
	assert.NotContains(t, headers, "X-Project-Id", "no project id is sent when none is known")
	assert.NotContains(t, headers, "X-Auth-Token", "the legacy header is no longer emitted")
}

func TestBuildAuthHeaders_KeyWithProjectID(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "")
	headers := buildAuthHeaders("sk-lw-legacy", "project_123")

	assert.Equal(t, "Bearer sk-lw-legacy", headers["Authorization"])
	assert.Equal(t, "project_123", headers["X-Project-Id"])
}

func TestBuildAuthHeaders_PATWithProjectID(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "")
	headers := buildAuthHeaders("pat-lw-abc_secret", "project_123")

	assert.Equal(t, "Bearer pat-lw-abc_secret", headers["Authorization"])
	assert.Equal(t, "project_123", headers["X-Project-Id"])
}

func TestBuildAuthHeaders_UsesEnvProjectID(t *testing.T) {
	t.Setenv("LANGWATCH_PROJECT_ID", "env_project")
	headers := buildAuthHeaders("pat-lw-envtok", "")

	assert.Equal(t, "Bearer pat-lw-envtok", headers["Authorization"])
	assert.Equal(t, "env_project", headers["X-Project-Id"])
}
