// Package claudesettings installs optional hooks in Claude Code's local settings.
package claudesettings

import (
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/hooksettings"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Settings writes only the caller's worktree-local Claude configuration.
type Settings struct{}

func New() Settings { return Settings{} }

func (Settings) EnsureHook(repoRoot, command string) (bool, error) {
	path := filepath.Join(repoRoot, ".claude", "settings.local.json")
	return hooksettings.EnsureHook(path, command, domain.HookMatcher())
}

// Off opts this worktree out of the gate hook: it removes any existing
// registration and records the opt-out, so a later EnsureHook here - including
// the one `haven up` makes automatically - is a no-op.
func (Settings) Off(repoRoot string) (bool, error) {
	path := filepath.Join(repoRoot, ".claude", "settings.local.json")
	return hooksettings.Off(path)
}
