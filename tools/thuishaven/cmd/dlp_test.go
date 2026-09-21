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

// The opt-out is the one knob haven both reads and writes: it injects
// LANGWATCH_DISABLE_GOOGLE_DLP=true into .env.portless, which LoadDotenv then
// merges *after* .env. Resolving the operator's preference from the merged
// layers therefore reads back haven's own previous answer, and a developer who
// sets `false` in .env to exercise DLP locally can never win — the second
// `haven up` sees the "true" it wrote itself and rewrites it forever.
//
// @scenario "Local dev opts out of Google DLP by default"
func TestOptingBackIntoDLPIsNotOverriddenByHavensOwnOverlay(t *testing.T) {
	const key = "LANGWATCH_DISABLE_GOOGLE_DLP"

	lwDir := t.TempDir()
	writeFile(t, filepath.Join(lwDir, ".env"), key+"=false\n")
	writeFile(t, filepath.Join(lwDir, ".env.portless"), key+"=true\n")

	t.Run("given the merged layers, haven reads back its own overlay", func(t *testing.T) {
		merged := domain.LoadDotenv(lwDir)

		if got := merged[key]; got != "true" {
			t.Fatalf("precondition failed: merged layers gave %q, want %q — "+
				"if the overlay no longer wins, this test no longer guards anything", got, "true")
		}
		if !shouldDisableGoogleDLP(merged[key], true) {
			t.Fatal("precondition failed: the overlay value should force DLP off")
		}
	})

	// operatorEnvIn is the reader operatorEnvKnobs actually uses, so swapping it
	// back to the merged layers fails here rather than passing quietly.
	t.Run("when the operator env reader is consulted", func(t *testing.T) {
		operator := operatorEnvIn(lwDir)

		value, isSet := operator[key]
		if !isSet {
			t.Fatalf("%s should have been read from .env", key)
		}
		if shouldDisableGoogleDLP(value, isSet) {
			t.Error("an operator who set false in .env must be able to exercise DLP locally")
		}
	})
}

func writeFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
