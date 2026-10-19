package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The app parses LANGWATCH_DISABLE_GOOGLE_DLP with the repo's boolean rule — a
// case-insensitive "true", everything else false (env-create.mjs). haven has to
// agree on what a *set* value means, or the same variable resolves differently
// either side of the overlay.
//
// @scenario "Local dev opts out of Google DLP by default"
func TestShouldDisableGoogleDLPMatchesTheAppsBooleanRule(t *testing.T) {
	t.Run("given the variable is unset", func(t *testing.T) {
		if !shouldDisableGoogleDLP("", false) {
			t.Error("local stacks must disable Google DLP by default")
		}
	})

	t.Run("when the value is one the app reads as true", func(t *testing.T) {
		for _, value := range []string{"true", "TRUE", "True"} {
			if !shouldDisableGoogleDLP(value, true) {
				t.Errorf("%q should disable Google DLP", value)
			}
		}
	})

	t.Run("when the value is one the app reads as false", func(t *testing.T) {
		// "FALSE" and "0" are the cases an exact `!= "false"` comparison got
		// wrong: haven forced the override off while the app read them as false.
		for _, value := range []string{"false", "FALSE", "False", "0", "no", ""} {
			if shouldDisableGoogleDLP(value, true) {
				t.Errorf("%q should leave LANGWATCH_DISABLE_GOOGLE_DLP to .env", value)
			}
		}
	})
}

// The opt-out is the one knob haven both reads and writes, and the reason it
// can be read from .env at all is that haven's overlay never reaches a file.
// While it did, the second `haven up` read back the "true" it had written
// itself, concluded the operator had asked for it, and rewrote it forever — so
// a developer who set `false` in .env to exercise DLP locally could never win.
//
// @scenario "Local dev opts out of Google DLP by default"
func TestOptingBackIntoDLPWinsBecauseTheOverlayIsNotAFile(t *testing.T) {
	const key = "LANGWATCH_DISABLE_GOOGLE_DLP"

	repoRoot := t.TempDir()
	writeFile(t, filepath.Join(repoRoot, ".env"), key+"=false\n")
	// What an older haven left behind, and what a checkout hook could copy in.
	// It must not be read: it is haven's own last answer, not the operator's.
	writeFile(t, filepath.Join(repoRoot, ".env.portless"), key+"=true\n")
	writeFile(t, filepath.Join(repoRoot, ".env.haven"), key+"=true\n")

	t.Run("given a retired overlay file sitting beside .env", func(t *testing.T) {
		t.Run("when haven resolves its own knobs", func(t *testing.T) {
			resolved := domain.LoadDotenv(repoRoot)

			value, isSet := resolved[key]
			if !isSet {
				t.Fatalf("%s should have been read from .env", key)
			}
			if value != "false" {
				t.Fatalf("resolved %q from the dotenv layers, want %q — a retired overlay must never be read back", value, "false")
			}
			if shouldDisableGoogleDLP(value, isSet) {
				t.Error("an operator who set false in .env must be able to exercise DLP locally")
			}
		})
	})
}

func writeFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
