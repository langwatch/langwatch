// Package hooksettings merges compatible JSON hook configuration for agent clients.
package hooksettings

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// offKey marks a settings file as opted out of the gate hook, so a later
// EnsureHook for the same path - including the automatic one `haven up` makes
// on every start - is a no-op until a developer runs `haven setup <feature>`
// again without --off. It lives beside "hooks" rather than in a second file:
// one file to read, one place the opt-out can be found.
const offKey = "havenGateHookOff"

// EnsureHook merges one gate command into an agent's local hook configuration.
func EnsureHook(path, command, matcher string) (bool, error) {
	settings, err := readSettings(path)
	if err != nil {
		return false, err
	}
	if settings[offKey] == true {
		// Turned off on purpose (`haven setup <feature> --off`). Both a manual
		// install and haven up's automatic one must honor it, or the opt-out
		// would not survive the next `haven up`.
		return false, nil
	}

	isChanged, err := mergeHook(settings, command, matcher)
	if err != nil {
		return false, fmt.Errorf("%s: %w", path, err)
	}
	if !isChanged {
		return false, nil
	}
	if err := writeSettings(path, settings); err != nil {
		return false, err
	}
	return true, nil
}

// Off opts path out of the gate hook: it removes any existing registration and
// records the opt-out, so a later EnsureHook for the same path is a no-op.
func Off(path string) (bool, error) {
	settings, err := readSettings(path)
	if err != nil {
		return false, err
	}
	changed := removeGateHook(settings)
	if settings[offKey] != true {
		settings[offKey] = true
		changed = true
	}
	if !changed {
		return false, nil
	}
	if err := writeSettings(path, settings); err != nil {
		return false, err
	}
	return true, nil
}

// readSettings reads and parses the JSON object at path, or reports why it
// refuses to: an unparseable file, an unreadable one, or one that is valid
// JSON but not an object are all someone else's file, not ours to replace.
func readSettings(path string) (map[string]any, error) {
	settings := map[string]any{}
	existing, readErr := os.ReadFile(path) // #nosec G304 -- repoRoot is git's own toplevel
	switch {
	case readErr == nil:
		if err := json.Unmarshal(existing, &settings); err != nil {
			// Someone else's file that we cannot parse is someone else's file.
			// Refusing beats overwriting it with our own idea of its contents.
			return nil, fmt.Errorf("%s is not valid JSON; leaving it alone: %w", path, err)
		}
	case !errors.Is(readErr, fs.ErrNotExist):
		// Absent is the only read failure that means "nothing to preserve".
		// EACCES, EISDIR, a symlink loop or a transient I/O error all mean a file
		// IS there and we cannot see it — and writing our own would replace the
		// developer's agent settings with a file built from an empty map.
		return nil, fmt.Errorf("cannot read %s; leaving it alone: %w", path, readErr)
	}
	if settings == nil {
		return nil, fmt.Errorf("%s is not a JSON object; leaving it alone", path)
	}
	return settings, nil
}

// writeSettings atomically replaces path with settings.
func writeSettings(path string, settings map[string]any) error {
	body, marshalErr := json.MarshalIndent(settings, "", "  ")
	if marshalErr != nil {
		return marshalErr
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	return atomicfile.Write(path, append(body, '\n'), 0o600)
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
func mergeHook(settings map[string]any, command, matcher string) (bool, error) {
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
		if !updateGateHook(entry, hook, command, matcher) {
			return false, nil
		}
		hooks["PreToolUse"] = entries
		settings["hooks"] = hooks
		return true, nil
	}

	hooks["PreToolUse"] = append(entries, hookEntry(command, matcher))
	settings["hooks"] = hooks
	return true, nil
}

// updateGateHook brings an already-installed gate up to date, reporting whether
// anything changed.
func updateGateHook(entry any, hook map[string]any, command, matcher string) bool {
	isCommandChanged := hook["command"] != command
	if isCommandChanged {
		// The nested hook's own command, not the entry around it: an entry may
		// hold several hooks, and replacing the whole block to update one of them
		// would delete the developer's siblings.
		hook["command"] = command
	}
	// Not `||`: the matcher has to be reconciled whether or not the command moved,
	// and short-circuiting would skip it exactly when it matters most.
	isMatcherChanged := reconcileMatcher(entry, matcher)
	return isCommandChanged || isMatcherChanged
}

// reconcileMatcher brings an installed entry's matcher up to the current tool
// set, reporting whether it changed anything.
//
// Without this, widening the tool set reaches nobody who already ran
// `haven setup`. haven's own path usually has not moved, so the merge above finds
// the command equal, reports "no change", and leaves the old matcher in place —
// and a matcher missing a tool is a branch of the gate that never runs, which is
// the defect this pass exists to fix rather than reproduce one release later.
//
// It declines when haven's gate is not alone in the entry. The matcher belongs to
// the entry rather than to any one hook inside it, so widening one that a
// developer's own hook also sits in would silently re-route THEIR hook onto tools
// they never asked it to see.
func reconcileMatcher(entry any, matcher string) bool {
	block, isObject := entry.(map[string]any)
	if !isObject {
		return false
	}
	if siblings, isArray := block["hooks"].([]any); !isArray || len(siblings) != 1 {
		return false
	}
	if block["matcher"] == matcher {
		return false
	}
	block["matcher"] = matcher
	return true
}

// removeGateHook strips haven's own hook out of the PreToolUse list, reporting
// whether it found one to remove. An entry that existed only to carry haven's
// hook is dropped entirely; an entry shared with another hook keeps its
// siblings and loses only haven's own - the same distinction updateGateHook
// draws going the other way.
func removeGateHook(settings map[string]any) bool {
	hooks, isObject := settings["hooks"].(map[string]any)
	if !isObject {
		return false
	}
	entries, isArray := hooks["PreToolUse"].([]any)
	if !isArray {
		return false
	}
	kept := make([]any, 0, len(entries))
	changed := false
	for _, entry := range entries {
		survivor, wasChanged := entryWithoutGateHook(entry)
		changed = changed || wasChanged
		if survivor != nil {
			kept = append(kept, survivor)
		}
	}
	if !changed {
		return false
	}
	hooks["PreToolUse"] = kept
	settings["hooks"] = hooks
	return true
}

// entryWithoutGateHook strips haven's own hook out of one PreToolUse entry,
// reporting the entry to keep (nil when it existed only to carry haven's own
// hook, so it is dropped entirely) and whether anything changed.
func entryWithoutGateHook(entry any) (survivor any, changed bool) {
	block, isObject := entry.(map[string]any)
	if !isObject {
		return entry, false
	}
	inner, isArray := block["hooks"].([]any)
	if !isArray {
		return entry, false
	}
	remaining := make([]any, 0, len(inner))
	for _, h := range inner {
		if isHavenGateHook(h) {
			changed = true
			continue
		}
		remaining = append(remaining, h)
	}
	if len(remaining) == 0 {
		return nil, changed
	}
	block["hooks"] = remaining
	return entry, changed
}

// isHavenGateHook reports whether one nested hook entry is haven's own gate.
func isHavenGateHook(h any) bool {
	hook, isObject := h.(map[string]any)
	if !isObject {
		return false
	}
	command, isString := hook["command"].(string)
	return isString && isHavenGate(command)
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
//
// The split has to be shell-aware for the same reason the path is quoted in the
// first place. Splitting on whitespace would read `'/src/my worktree/haven'
// gate` as four words starting with `'/src`, decide the hook is a stranger's,
// and append a second gate — so every checkout with a space in its path would
// collect another hook on every `haven setup` and gate each tool call twice.
func isHavenGate(command string) bool {
	words := domain.ShellWords(command)
	if len(words) >= 4 && words[len(words)-2] == "--client" && words[len(words)-1] == "codex" {
		words = words[:len(words)-2]
	}
	if len(words) < 2 || words[len(words)-1] != gateSubcommand {
		return false
	}
	return filepath.Base(words[0]) == havenBinary
}

const (
	gateSubcommand = "gate"
	havenBinary    = "haven"
)

// hookEntry is the PreToolUse block haven installs.
func hookEntry(command, matcher string) map[string]any {
	return map[string]any{
		"matcher": matcher,
		"hooks": []any{map[string]any{
			"type":    "command",
			"command": command,
			"timeout": 10,
		}},
	}
}
