// Package claudesettings edits Claude Code's own configuration in a checkout.
//
// Its own package, not a method on the stack registry: everything haven
// persists elsewhere is haven's state, and this writes a file that belongs to
// another tool. Only `haven setup` reaches for it.
package claudesettings

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
)

// Settings is the filesystem-backed implementation of app.ClaudeSettings.
type Settings struct{}

// New returns a Settings.
func New() Settings { return Settings{} }

// EnsureHook registers command as a PreToolUse hook in this checkout's
// own Claude settings.
//
// settings.LOCAL.json, deliberately: .gitignore carries
// `**/.claude/settings.local.json*` while .claude/settings.json is checked in,
// so this configures the developer's checkout without committing a hook into
// everyone else's. repoRoot comes from `git rev-parse --show-toplevel`, which
// in a worktree resolves to that worktree — so each one gets its own file,
// matching the fact that each gets its own stack.
func (Settings) EnsureHook(repoRoot, command string) (bool, error) {
	path := filepath.Join(repoRoot, ".claude", "settings.local.json")

	settings := map[string]any{}
	existing, readErr := os.ReadFile(path) // #nosec G304 -- repoRoot is git's own toplevel
	switch {
	case readErr == nil:
		if err := json.Unmarshal(existing, &settings); err != nil {
			// Someone else's file that we cannot parse is someone else's file.
			// Refusing beats overwriting it with our own idea of its contents.
			return false, fmt.Errorf("%s is not valid JSON; leaving it alone: %w", path, err)
		}
	case !errors.Is(readErr, fs.ErrNotExist):
		// Absent is the only read failure that means "nothing to preserve".
		// EACCES, EISDIR, a symlink loop or a transient I/O error all mean a file
		// IS there and we cannot see it — and writing our own would replace the
		// developer's Claude settings with a file built from an empty map.
		return false, fmt.Errorf("cannot read %s; leaving it alone: %w", path, readErr)
	}

	changed, err := mergeHook(settings, command)
	if err != nil {
		return false, fmt.Errorf("%s: %w", path, err)
	}
	if !changed {
		return false, nil
	}

	body, marshalErr := json.MarshalIndent(settings, "", "  ")
	if marshalErr != nil {
		return false, marshalErr
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return false, err
	}
	if err := atomicfile.Write(path, append(body, '\n'), 0o600); err != nil {
		return false, err
	}
	return true, nil
}

// mergeHook adds the entry unless one already runs this exact command,
// and reports whether it changed anything — so a second `haven setup` is a
// no-op rather than a duplicate hook or a pointless rewrite.
//
// An existing haven entry whose command DIFFERS is replaced in place rather
// than appended to. haven's own absolute path moves (a `go install`, a renamed
// worktree), and appending would leave a stale entry behind that either fails to
// exec on every tool call or gates each one twice.
//
// A block of an unexpected shape is refused, not replaced: settings["hooks"] or
// its PreToolUse list holding something other than the object and array they are
// supposed to be means the file is not ours to rewrite.
func mergeHook(settings map[string]any, command string) (bool, error) {
	hooks, ok := settings["hooks"].(map[string]any)
	if !ok && settings["hooks"] != nil {
		return false, errors.New(`"hooks" is not an object`)
	}
	if hooks == nil {
		hooks = map[string]any{}
	}
	entries, ok := hooks["PreToolUse"].([]any)
	if !ok && hooks["PreToolUse"] != nil {
		return false, errors.New(`"hooks.PreToolUse" is not an array`)
	}

	for i, e := range entries {
		existing, isGate := gateHookCommand(e)
		if !isGate {
			continue
		}
		if existing == command {
			return false, nil
		}
		entries[i] = claudeHookEntry(command)
		settings["hooks"] = hooks
		hooks["PreToolUse"] = entries
		return true, nil
	}

	hooks["PreToolUse"] = append(entries, claudeHookEntry(command))
	settings["hooks"] = hooks
	return true, nil
}

// gateHookCommand reads the command out of one PreToolUse entry and reports
// whether it is a haven gate.
//
// The test is the ` gate` SUFFIX rather than a substring: `gate` appears inside
// plenty of unrelated words — a hook running `run gateway-lint` contains it and
// is nobody's gate — and a substring match there would make setup report success
// while installing nothing.
func gateHookCommand(entry any) (string, bool) {
	block, ok := entry.(map[string]any)
	if !ok {
		return "", false
	}
	inner, ok := block["hooks"].([]any)
	if !ok {
		return "", false
	}
	for _, h := range inner {
		hook, ok := h.(map[string]any)
		if !ok {
			continue
		}
		if cmd, ok := hook["command"].(string); ok && strings.HasSuffix(cmd, " gate") {
			return cmd, true
		}
	}
	return "", false
}

// claudeHookEntry is the PreToolUse block haven installs.
func claudeHookEntry(command string) map[string]any {
	return map[string]any{
		"matcher": "Bash|Agent",
		"hooks": []any{map[string]any{
			"type":    "command",
			"command": command,
			"timeout": 10,
		}},
	}
}
