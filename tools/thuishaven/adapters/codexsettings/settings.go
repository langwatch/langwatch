// Package codexsettings installs optional hooks in Codex's local hook file.
package codexsettings

import (
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/hooksettings"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// hookMatcher wakes the gate for Bash and for Playwright's MCP tools, which it refuses.
var hookMatcher = "^(Bash|" + domain.PlaywrightToolMatcher + ")$"

// Settings preserves existing hooks and leaves Codex trust decisions to Codex.
type Settings struct{}

// New returns the Codex hook settings adapter.
func New() Settings { return Settings{} }

// EnsureHook adds command to the worktree's Codex hook file as a Bash and
// Playwright MCP hook, reporting whether the file changed.
func (Settings) EnsureHook(repoRoot, command string) (bool, error) {
	path := filepath.Join(repoRoot, ".codex", "hooks.json")
	return hooksettings.EnsureHook(path, command, hookMatcher)
}

// Off opts this worktree out of the gate hook: it removes any existing
// registration and records the opt-out, so a later EnsureHook here is a no-op.
func (Settings) Off(repoRoot string) (bool, error) {
	path := filepath.Join(repoRoot, ".codex", "hooks.json")
	return hooksettings.Off(path)
}
