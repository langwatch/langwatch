// Package codexsettings installs optional hooks in Codex's local hook file.
package codexsettings

import (
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/hooksettings"
)

// Settings preserves existing hooks and leaves Codex trust decisions to Codex.
type Settings struct{}

func New() Settings { return Settings{} }

func (Settings) EnsureHook(repoRoot, command string) (bool, error) {
	path := filepath.Join(repoRoot, ".codex", "hooks.json")
	return hooksettings.EnsureHook(path, command, "^Bash$")
}
