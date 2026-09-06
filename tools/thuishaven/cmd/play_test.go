package cmd

import (
	"strings"
	"testing"
)

// confirmWith drives the interactive trust gate over canned input and returns
// the verdict along with everything the developer would have seen.
func confirmWith(t *testing.T, typed string) (bool, string) {
	t.Helper()
	var out strings.Builder
	ok := confirmUntrustedPlayVia(strings.NewReader(typed), &out, []string{"mallory"}, 4913)
	return ok, out.String()
}

// @scenario "Untrusted code takes a second, deliberate confirmation"
func TestUntrustedPlayNeedsBothSteps(t *testing.T) {
	t.Run("when the developer answers yes and types the PR number", func(t *testing.T) {
		ok, shown := confirmWith(t, "y\n4913\n")
		if !ok {
			t.Fatal("both steps answered correctly, want play to proceed")
		}
		if !strings.Contains(shown, "mallory") {
			t.Error("the first step never named the untrusted author")
		}
		if !strings.Contains(shown, "as you, from this shell's environment") {
			t.Errorf("the second step never disclosed what the PR is given:\n%s", shown)
		}
	})

	t.Run("when the developer answers yes twice", func(t *testing.T) {
		// The whole point of the second step: the reflex that clears the first
		// prompt must not clear this one too.
		if ok, _ := confirmWith(t, "y\ny\n"); ok {
			t.Error("a second \"y\" passed the typed confirmation")
		}
	})

	t.Run("when the developer hits enter at the second step", func(t *testing.T) {
		if ok, _ := confirmWith(t, "y\n\n"); ok {
			t.Error("an empty line passed the typed confirmation")
		}
	})

	t.Run("when the developer types a different PR's number", func(t *testing.T) {
		if ok, _ := confirmWith(t, "y\n4912\n"); ok {
			t.Error("another PR's number passed the confirmation for 4913")
		}
	})

	t.Run("when stdin ends before the second step is answered", func(t *testing.T) {
		// A pipe that closes mid-gate must abort, never fall through to yes.
		if ok, _ := confirmWith(t, "y\n"); ok {
			t.Error("EOF at the second step proceeded")
		}
	})

	t.Run("when the answer arrives in one buffered write", func(t *testing.T) {
		// Both steps share a reader precisely so this works: a second reader
		// over the same stdin would have swallowed "4913" with the first read.
		if ok, _ := confirmWith(t, "y\n4913\n"); !ok {
			t.Error("the buffered second answer was lost between the two steps")
		}
	})
}

// @scenario "Declining the first prompt never reaches the second"
func TestDecliningTheFirstStepStopsThere(t *testing.T) {
	for _, answer := range []string{"\n", "n\n", "no\n", "", "anything\n"} {
		ok, shown := confirmWith(t, answer)
		if ok {
			t.Errorf("first step answered %q, want play to abort", answer)
		}
		if strings.Contains(shown, "as you, from this shell's environment") {
			t.Errorf("first step answered %q still printed the second step:\n%s", answer, shown)
		}
	}
}
