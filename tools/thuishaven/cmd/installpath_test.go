package cmd

import (
	"strings"
	"testing"
)

// The question is only asked where the answer is almost certainly yes, and
// the line it adds is one line a developer can delete — so return means yes.
// @scenario "Go bin dir missing from PATH, user accepts"
func TestAnEmptyAnswerAccepts(t *testing.T) {
	for _, answer := range []string{"\n", "y\n", "Y\n", "yes\n", "  \n"} {
		if !yes(strings.NewReader(answer)) {
			t.Errorf("%q should read as yes", answer)
		}
	}
}

// @scenario "Go bin dir missing from PATH, user declines"
func TestAnExplicitNoDeclines(t *testing.T) {
	for _, answer := range []string{"n\n", "N\n", "no\n", "No\n"} {
		if yes(strings.NewReader(answer)) {
			t.Errorf("%q should read as no", answer)
		}
	}
}

// A closed pipe mid-prompt is not consent. Reading it as yes would edit a
// shell config because a terminal went away.
// @scenario "Non-interactive install never edits the rc file"
func TestAClosedPipeDeclines(t *testing.T) {
	if yes(strings.NewReader("")) {
		t.Error("EOF with no answer must leave the file untouched")
	}
}
