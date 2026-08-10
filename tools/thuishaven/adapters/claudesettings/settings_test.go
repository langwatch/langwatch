package claudesettings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func settingsPath(root string) string {
	return filepath.Join(root, ".claude", "settings.local.json")
}

func mustRead(t *testing.T, root string) []byte {
	t.Helper()
	b, err := os.ReadFile(settingsPath(root))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func writeSettings(t *testing.T, root, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, ".claude"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(settingsPath(root), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readSettings(t *testing.T, root string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(settingsPath(root))
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("haven wrote settings that are not valid JSON: %v", err)
	}
	return out
}

// preToolUse pulls the hook list out of a settings map, or fails.
func preToolUse(t *testing.T, settings map[string]any) []any {
	t.Helper()
	hooks, isObject := settings["hooks"].(map[string]any)
	if !isObject {
		t.Fatalf("expected a hooks object, got %T", settings["hooks"])
	}
	entries, isArray := hooks["PreToolUse"].([]any)
	if !isArray {
		t.Fatalf("expected a PreToolUse array, got %T", hooks["PreToolUse"])
	}
	return entries
}

// @scenario "The gate hook is installed into this worktree's own Claude settings"
func TestEnsureHookInstallsIntoTheWorktree(t *testing.T) {
	t.Run("given a checkout with no Claude settings yet", func(t *testing.T) {
		root := t.TempDir()

		t.Run("when the hook is installed", func(t *testing.T) {
			isInstalled, err := New().EnsureHook(root, "/opt/haven gate")
			if err != nil || !isInstalled {
				t.Fatalf("expected an install, got installed=%v err=%v", isInstalled, err)
			}

			t.Run("the entry lands in the untracked settings file", func(t *testing.T) {
				if got := len(preToolUse(t, readSettings(t, root))); got != 1 {
					t.Fatalf("expected one entry, got %d", got)
				}
			})

			t.Run("and installing it again changes nothing", func(t *testing.T) {
				isInstalled, err := New().EnsureHook(root, "/opt/haven gate")
				if err != nil {
					t.Fatal(err)
				}
				if isInstalled {
					t.Fatal("a second setup must be a no-op, not a duplicate hook")
				}
			})
		})
	})
}

// @scenario "Settings haven cannot read are never overwritten"
func TestEnsureHookRefusesToOverwriteWhatItCannotRead(t *testing.T) {
	t.Run("given a settings file that is not valid JSON", func(t *testing.T) {
		root := t.TempDir()
		writeSettings(t, root, "{ this is not json")

		t.Run("when the hook is installed", func(t *testing.T) {
			isInstalled, err := New().EnsureHook(root, "/opt/haven gate")

			t.Run("it refuses, and the file is left exactly as it was", func(t *testing.T) {
				if err == nil || isInstalled {
					t.Fatal("someone else's file must not be replaced with our own idea of it")
				}
				b, readErr := os.ReadFile(settingsPath(root))
				if readErr != nil || string(b) != "{ this is not json" {
					t.Fatalf("the original content was not preserved: %q / %v", b, readErr)
				}
			})
		})
	})

	t.Run("given a settings path that cannot be read at all", func(t *testing.T) {
		// A directory where the file should be: os.ReadFile fails with something
		// other than "does not exist", which is the case that used to fall through
		// to a write and replace the developer's settings with an empty map.
		root := t.TempDir()
		if err := os.MkdirAll(settingsPath(root), 0o750); err != nil {
			t.Fatal(err)
		}

		t.Run("when the hook is installed", func(t *testing.T) {
			isInstalled, err := New().EnsureHook(root, "/opt/haven gate")

			t.Run("it refuses rather than writing over it", func(t *testing.T) {
				if err == nil || isInstalled {
					t.Fatal("an unreadable file is still a file; refusing beats replacing")
				}
			})
		})
	})

	t.Run("given a hooks block of an unexpected shape", func(t *testing.T) {
		root := t.TempDir()
		writeSettings(t, root, `{"hooks": {"PreToolUse": "not-an-array"}}`)

		t.Run("when the hook is installed", func(t *testing.T) {
			isInstalled, err := New().EnsureHook(root, "/opt/haven gate")

			t.Run("it refuses rather than replacing the developer's value", func(t *testing.T) {
				if err == nil || isInstalled {
					t.Fatal("a shape we do not understand is not ours to rewrite")
				}
			})
		})
	})
}

// @scenario "An unrelated hook whose command merely contains the word is not mistaken for the gate"
func TestEnsureHookMatchesTheGateAndNotMerelyTheWord(t *testing.T) {
	// Both of these contain the word and neither is haven's: one has it inside a
	// longer word, the other as its own final word. Identity is the executable.
	for _, unrelated := range []string{"run gateway-lint", "run quality gate"} {
		t.Run("given a pre-existing hook running "+unrelated, func(t *testing.T) {
			root := t.TempDir()
			writeSettings(t, root, `{"hooks": {"PreToolUse": [
				{"matcher": "Bash", "hooks": [{"type": "command", "command": "`+unrelated+`"}]}
			]}}`)

			t.Run("when the gate is installed", func(t *testing.T) {
				isInstalled, err := New().EnsureHook(root, "/opt/haven gate")
				if err != nil {
					t.Fatal(err)
				}

				t.Run("it is actually installed, rather than mistaken for already present", func(t *testing.T) {
					if !isInstalled {
						t.Fatal("reporting success without writing is the worst outcome")
					}
					if got := len(preToolUse(t, readSettings(t, root))); got != 2 {
						t.Fatalf("expected the existing hook kept alongside the new one, got %d", got)
					}
				})

				t.Run("and the stranger's command is left untouched", func(t *testing.T) {
					if !strings.Contains(string(mustRead(t, root)), unrelated) {
						t.Fatalf("haven rewrote a hook that was not its own: %s", mustRead(t, root))
					}
				})
			})
		})
	}

	t.Run("given a haven gate installed from a path that has since moved", func(t *testing.T) {
		root := t.TempDir()
		writeSettings(t, root, `{"hooks": {"PreToolUse": [
			{"matcher": "Bash|Agent", "hooks": [{"type": "command", "command": "/old/haven gate"}]}
		]}}`)

		t.Run("when the gate is installed from its new path", func(t *testing.T) {
			isInstalled, err := New().EnsureHook(root, "/new/haven gate")
			if err != nil {
				t.Fatal(err)
			}

			t.Run("the stale entry is replaced rather than joined by a second one", func(t *testing.T) {
				if !isInstalled {
					t.Fatal("a moved path is a change worth writing")
				}
				entries := preToolUse(t, readSettings(t, root))
				if len(entries) != 1 {
					t.Fatalf("a duplicate gates every tool call twice; got %d entries", len(entries))
				}
			})
		})
	})

	t.Run("given a moved gate sharing its entry with another hook", func(t *testing.T) {
		root := t.TempDir()
		writeSettings(t, root, `{"hooks": {"PreToolUse": [
			{"matcher": "Bash", "hooks": [
				{"type": "command", "command": "/old/haven gate"},
				{"type": "command", "command": "notify-me"}
			]}
		]}}`)

		t.Run("when the gate is updated", func(t *testing.T) {
			if _, err := New().EnsureHook(root, "/new/haven gate"); err != nil {
				t.Fatal(err)
			}
			written := string(mustRead(t, root))

			t.Run("only haven's own command changes", func(t *testing.T) {
				if !strings.Contains(written, "/new/haven gate") || strings.Contains(written, "/old/haven gate") {
					t.Fatalf("the gate was not updated in place: %s", written)
				}
			})

			t.Run("and the hook sharing the entry survives", func(t *testing.T) {
				// Replacing the whole entry to update one hook inside it takes the
				// developer's siblings with it.
				if !strings.Contains(written, "notify-me") {
					t.Fatalf("a sibling hook was deleted: %s", written)
				}
			})
		})
	})
}

// @scenario "A gate installed from a path with a space is still recognised as haven's own"
func TestEnsureHookRecognisesItsOwnQuotedPath(t *testing.T) {
	t.Run("given a gate installed from a worktree whose name has a space in it", func(t *testing.T) {
		root := t.TempDir()
		command := domain.ShellQuote("/src/my worktree/haven") + " gate"

		if _, err := New().EnsureHook(root, command); err != nil {
			t.Fatal(err)
		}

		t.Run("when setup runs again", func(t *testing.T) {
			isInstalled, err := New().EnsureHook(root, command)
			if err != nil {
				t.Fatal(err)
			}

			t.Run("haven recognises its own handiwork and writes nothing", func(t *testing.T) {
				// Split on whitespace this reads as `'/src`, and haven decides the
				// hook belongs to a stranger — so every checkout with a space in its
				// path collects one more gate per setup, each gating every call.
				if isInstalled {
					t.Fatal("the gate was not recognised, so a duplicate was installed")
				}
				if got := len(preToolUse(t, readSettings(t, root))); got != 1 {
					t.Fatalf("expected the one entry it wrote, got %d", got)
				}
			})
		})
	})
}

// @scenario "Settings haven does not own are merged rather than replaced"
func TestEnsureHookPreservesEverythingElse(t *testing.T) {
	t.Run("given settings carrying unrelated keys and hooks", func(t *testing.T) {
		root := t.TempDir()
		writeSettings(t, root, `{
			"permissions": {"allow": ["Bash(ls:*)"]},
			"hooks": {"PostToolUse": [{"matcher": "Edit"}]}
		}`)

		t.Run("when the gate is installed", func(t *testing.T) {
			if _, err := New().EnsureHook(root, "/opt/haven gate"); err != nil {
				t.Fatal(err)
			}
			settings := readSettings(t, root)

			t.Run("the unrelated top-level keys survive", func(t *testing.T) {
				if settings["permissions"] == nil {
					t.Fatal("haven took a hook and dropped the developer's permissions")
				}
			})

			t.Run("and so do the hooks for other events", func(t *testing.T) {
				hooks, _ := settings["hooks"].(map[string]any)
				if hooks["PostToolUse"] == nil {
					t.Fatal("an existing hooks block must survive the merge")
				}
			})
		})
	})
}
