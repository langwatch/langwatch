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

// New builds the writer. It holds no state: every call is handed the repo root
// it should write in, so one instance serves every worktree on the machine.
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

	isChanged, err := mergeHook(settings, command)
	if err != nil {
		return false, fmt.Errorf("%s: %w", path, err)
	}
	if !isChanged {
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
	hooks, isObject := settings["hooks"].(map[string]any)
	if !isObject && settings["hooks"] != nil {
		return false, errors.New(`"hooks" is not an object`)
	}
	if hooks == nil {
		hooks = map[string]any{}
	}
	entries, isArray := hooks["PreToolUse"].([]any)
	if !isArray && hooks["PreToolUse"] != nil {
		return false, errors.New(`"hooks.PreToolUse" is not an array`)
	}

	for _, entry := range entries {
		hook := findGateHook(entry)
		if hook == nil {
			continue
		}
		if hook["command"] == command {
			return false, nil
		}
		// The nested hook's own command, not the entry around it: an entry may
		// hold several hooks, and replacing the whole block to update one of them
		// would delete the developer's siblings.
		hook["command"] = command
		hooks["PreToolUse"] = entries
		settings["hooks"] = hooks
		return true, nil
	}

	hooks["PreToolUse"] = append(entries, claudeHookEntry(command))
	settings["hooks"] = hooks
	return true, nil
}

// findGateHook returns the nested hook inside one PreToolUse entry that runs
// haven's gate, or nil.
func findGateHook(entry any) map[string]any {
	block, isObject := entry.(map[string]any)
	if !isObject {
		return nil
	}
	inner, isArray := block["hooks"].([]any)
	if !isArray {
		return nil
	}
	for _, h := range inner {
		hook, isObject := h.(map[string]any)
		if !isObject {
			continue
		}
		if command, isString := hook["command"].(string); isString && isHavenGate(command) {
			return hook
		}
	}
	return nil
}

// isHavenGate reports whether a hook command is haven's own gate.
//
// It identifies the EXECUTABLE, not the word: `gate` is a perfectly ordinary
// thing to call something, and a hook running `run quality gate` or
// `run gateway-lint` belongs to whoever wrote it. Matching either of those
// would make `haven setup` report success having written nothing — or, worse,
// rewrite a stranger's hook.
//
// The command haven installs is its own absolute path (shell-quoted, since a
// checkout can live under a directory with a space) followed by the subcommand,
// so the test is: last word is the subcommand, and the first word names a file
// called haven.
func isHavenGate(command string) bool {
	fields := strings.Fields(command)
	if len(fields) < 2 || fields[len(fields)-1] != gateSubcommand {
		return false
	}
	executable := strings.Trim(fields[0], `'"`)
	return filepath.Base(executable) == havenBinary
}

const (
	gateSubcommand = "gate"
	havenBinary    = "haven"
)

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
