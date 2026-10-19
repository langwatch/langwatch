package template

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A template is customer input: include and render must never read a
// file from the server, by absolute path or by walking up from the cwd.
func TestRenderFull_RefusesFileTags(t *testing.T) {
	secret := filepath.Join(t.TempDir(), "secret.liquid")
	require.NoError(t, os.WriteFile(secret, []byte("SECRET-FILE-BODY"), 0o600))
	cwd, err := os.Getwd()
	require.NoError(t, err)
	climb := strings.Repeat("../", strings.Count(cwd, string(os.PathSeparator))) + strings.TrimPrefix(secret, "/")

	for _, tmpl := range []string{
		`{% include "` + secret + `" %}`,
		`{% include "` + climb + `" %}`,
		`{% render "` + climb + `" %}`,
	} {
		out, warnings := RenderFull("before "+tmpl+" after", map[string]any{})
		assert.NotContains(t, out, "SECRET-FILE-BODY", tmpl)
		require.Len(t, warnings, 1, tmpl)
		assert.Contains(t, warnings[0], "templates cannot include or render files", tmpl)
	}
}

func TestRenderFull_NormalTemplatesStillRender(t *testing.T) {
	out, warnings := RenderFull(`{% for m in items %}{{ m | upcase }} {% endfor %}`, map[string]any{"items": []any{"a", "b"}})
	assert.Empty(t, warnings)
	assert.Equal(t, "A B ", out)
}
