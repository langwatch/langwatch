package codexsettings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type hook struct {
	Type    string `json:"type"`
	Command string `json:"command"`
}

type matcherGroup struct {
	Matcher string `json:"matcher"`
	Hooks   []hook `json:"hooks"`
}

type hookFile struct {
	Description string                    `json:"description"`
	Hooks       map[string][]matcherGroup `json:"hooks"`
}

func readHooks(t *testing.T, root string) hookFile {
	t.Helper()
	contents, err := os.ReadFile(filepath.Join(root, ".codex", "hooks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var result hookFile
	if err := json.Unmarshal(contents, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func writeHooks(t *testing.T, root, contents string) string {
	t.Helper()
	path := filepath.Join(root, ".codex", "hooks.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// @scenario "Codex installs its gate hook in the current worktree"
func TestCodexGateIsLocalAndIdempotent(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	command := "'/opt/my tools/haven' gate --client codex"
	changed, err := New().EnsureHook(root, command)
	if err != nil || !changed {
		t.Fatalf("install: changed=%v err=%v", changed, err)
	}
	entries := readHooks(t, root).Hooks["PreToolUse"]
	if len(entries) != 1 || entries[0].Matcher != "^Bash$" || len(entries[0].Hooks) != 1 || entries[0].Hooks[0].Command != command {
		t.Fatalf("unexpected hook registration: %+v", entries)
	}
	changed, err = New().EnsureHook(root, command)
	if err != nil || changed {
		t.Fatalf("repeat install: changed=%v err=%v", changed, err)
	}
	for _, path := range []string{filepath.Join(other, ".codex", "hooks.json"), filepath.Join(root, ".codex", "config.toml"), filepath.Join(root, ".claude", "settings.local.json")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("unexpected write outside the selected Codex hook file: %s (%v)", path, err)
		}
	}
}

// @scenario "Codex setup preserves existing hooks and settings"
func TestCodexSetupPreservesExistingHooksAndSettings(t *testing.T) {
	root := t.TempDir()
	writeHooks(t, root, `{"description":"my hooks","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"my-security-check"}]}],"Stop":[{"hooks":[{"type":"command","command":"save-summary"}]}]}}`)
	configPath := filepath.Join(root, ".codex", "config.toml")
	config := "model = \"existing\"\n[features]\nhooks = false\n"
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New().EnsureHook(root, "/opt/haven gate"); err != nil {
		t.Fatal(err)
	}
	result := readHooks(t, root)
	if result.Description != "my hooks" || len(result.Hooks["PreToolUse"]) != 2 || result.Hooks["PreToolUse"][0].Hooks[0].Command != "my-security-check" || result.Hooks["Stop"][0].Hooks[0].Command != "save-summary" {
		t.Fatalf("existing hook configuration changed: %+v", result)
	}
	contents, err := os.ReadFile(configPath)
	if err != nil || string(contents) != config {
		t.Fatalf("existing feature settings changed: %q (%v)", contents, err)
	}
}

func TestCodexSetupUpdatesMovedGateWithoutChangingSiblingHooks(t *testing.T) {
	root := t.TempDir()
	writeHooks(t, root, `{"hooks":{"PreToolUse":[{"matcher":"Bash|Edit","hooks":[{"type":"command","command":"/old/haven gate"},{"type":"command","command":"another-hook"}]}]}}`)
	changed, err := New().EnsureHook(root, "/new/haven gate")
	if err != nil || !changed {
		t.Fatalf("update: changed=%v err=%v", changed, err)
	}
	entries := readHooks(t, root).Hooks["PreToolUse"]
	if len(entries) != 1 || entries[0].Matcher != "Bash|Edit" || len(entries[0].Hooks) != 2 || entries[0].Hooks[0].Command != "/new/haven gate" || entries[0].Hooks[1].Command != "another-hook" {
		t.Fatalf("unrelated hook or matcher changed: %+v", entries)
	}
}

func TestCodexSetupRefusesUnreadableConfiguration(t *testing.T) {
	for _, original := range []string{"null", "[]", "{broken", `{"hooks":false}`, `{"hooks":{"PreToolUse":"invalid"}}`} {
		t.Run(original, func(t *testing.T) {
			root := t.TempDir()
			path := writeHooks(t, root, original)
			changed, err := New().EnsureHook(root, "/opt/haven gate")
			if err == nil || changed {
				t.Fatalf("invalid configuration accepted: changed=%v err=%v", changed, err)
			}
			contents, readErr := os.ReadFile(path)
			if readErr != nil || string(contents) != original {
				t.Fatalf("invalid configuration overwritten: %q (%v)", contents, readErr)
			}
		})
	}
}

func TestCodexSetupDoesNotMistakeAnotherGateForHaven(t *testing.T) {
	root := t.TempDir()
	writeHooks(t, root, `{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"quality gate"}]}]}}`)
	if _, err := New().EnsureHook(root, "/opt/haven gate"); err != nil {
		t.Fatal(err)
	}
	entries := readHooks(t, root).Hooks["PreToolUse"]
	if len(entries) != 2 || !strings.Contains(entries[0].Hooks[0].Command, "quality") {
		t.Fatalf("unrelated gate overwritten: %+v", entries)
	}
}
