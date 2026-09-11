package domain

import (
	"strings"
	"testing"
)

// @scenario "Unrecognized shell falls back to instructions"
func TestShellRCPathPerShell(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		shell                    string
		home, zdotdir, xdgConfig string
		want                     string
	}{
		{"zsh uses .zshrc", "/bin/zsh", "/home/dev", "", "", "/home/dev/.zshrc"},
		{"zsh honours ZDOTDIR", "/bin/zsh", "/home/dev", "/home/dev/.config/zsh", "", "/home/dev/.config/zsh/.zshrc"},
		{"bash uses .bashrc", "/bin/bash", "/home/dev", "", "", "/home/dev/.bashrc"},
		{"fish uses config.fish", "/usr/local/bin/fish", "/home/dev", "", "", "/home/dev/.config/fish/config.fish"},
		{"fish honours XDG_CONFIG_HOME", "/usr/local/bin/fish", "/home/dev", "", "/cfg", "/cfg/fish/config.fish"},
		// A shell haven does not know gets no file at all. A wrong line in a
		// shell's config breaks every terminal opened afterwards, which is a
		// far worse outcome than printing the line and letting a human place it.
		{"an unknown shell yields nothing to edit", "/bin/nu", "/home/dev", "", "", ""},
		{"no shell at all yields nothing to edit", "", "/home/dev", "", "", ""},
	} {
		got := ShellRCPath(ShellKindOf(tc.shell), tc.home, tc.zdotdir, tc.xdgConfig)
		if got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

// fish has no `export`, and writing one into config.fish produces a shell
// that errors on every launch — from a line haven put there.
// @scenario "Unrecognized shell falls back to instructions"
func TestShellPathLineSpeaksEachShellsSyntax(t *testing.T) {
	if got := ShellPathLine(ShellFish, "/go/bin"); got != "fish_add_path /go/bin" {
		t.Errorf("fish line = %q", got)
	}
	for _, kind := range []ShellKind{ShellZsh, ShellBash, ShellUnknown} {
		if got := ShellPathLine(kind, "/go/bin"); got != `export PATH="/go/bin:$PATH"` {
			t.Errorf("posix line = %q", got)
		}
	}
}

// An entry, not a substring: /usr/local/bin must not be satisfied by
// /usr/local/bin-other, or haven reports a working PATH that isn't.
// @scenario "Go bin dir already on PATH"
func TestPathContainsMatchesWholeEntries(t *testing.T) {
	if !PathContains("/usr/bin:/go/bin:/bin", "/go/bin") {
		t.Error("an exact entry must match")
	}
	if PathContains("/usr/bin:/go/bin-other", "/go/bin") {
		t.Error("a prefix of a longer entry must not match")
	}
	if PathContains("", "/go/bin") || PathContains("/go/bin", "") {
		t.Error("empty either side matches nothing")
	}
}

// @scenario "Go bin dir already on PATH"
func TestPlanHavenPathReadyWhenAlreadyOnPath(t *testing.T) {
	state := PlanHavenPath(HavenPathFacts{BinDir: "/go/bin", PathEnv: "/bin:/go/bin", RCPath: "/home/dev/.zshrc"})
	if state != HavenPathReady {
		t.Errorf("state = %v, want ready — there is nothing to offer", state)
	}
}

// @scenario "Go bin dir missing from PATH, user accepts"
func TestPlanHavenPathOffersWhenThereIsAFileToEdit(t *testing.T) {
	state := PlanHavenPath(HavenPathFacts{BinDir: "/go/bin", PathEnv: "/bin", RCPath: "/home/dev/.zshrc"})
	if state != HavenPathOfferable {
		t.Errorf("state = %v, want offerable", state)
	}
}

// @scenario "Accepting twice does not duplicate the PATH line"
func TestPlanHavenPathDoesNotOfferWhatTheFileAlreadyHas(t *testing.T) {
	state := PlanHavenPath(HavenPathFacts{
		BinDir: "/go/bin", PathEnv: "/bin", RCPath: "/home/dev/.zshrc", RCHasLine: true,
	})
	if state != HavenPathPending {
		t.Errorf("state = %v, want pending — the line is there, the shell just has not been restarted", state)
	}
}

// @scenario "Unrecognized shell falls back to instructions"
func TestPlanHavenPathFallsBackToInstructionsForAnUnknownShell(t *testing.T) {
	state := PlanHavenPath(HavenPathFacts{BinDir: "/go/bin", PathEnv: "/bin"})
	if state != HavenPathManual {
		t.Errorf("state = %v, want manual", state)
	}
}

// No Go toolchain means no bin dir, and the prerequisite catalogue already
// reports that. Saying it twice, in two different vocabularies, is worse
// than saying it once.
// @scenario "Go bin dir already on PATH"
func TestPlanHavenPathSaysNothingWithoutAGoBinDir(t *testing.T) {
	if state := PlanHavenPath(HavenPathFacts{PathEnv: "/bin"}); state != HavenPathReady {
		t.Errorf("state = %v, want ready (silent)", state)
	}
}

// The block is attributed. An unexplained line in someone's shell config is
// the kind of thing that gets deleted with no idea what it breaks.
// @scenario "Go bin dir missing from PATH, user accepts"
func TestTheRCBlockSaysWhoWroteIt(t *testing.T) {
	block := HavenPathRCBlock(`export PATH="/go/bin:$PATH"`)
	if !strings.Contains(block, "haven install") || !strings.Contains(block, "langwatch") {
		t.Errorf("block %q must say who added it", block)
	}
	if !strings.Contains(block, `export PATH="/go/bin:$PATH"`) {
		t.Errorf("block %q must carry the line", block)
	}
	if !strings.HasPrefix(block, "\n") {
		t.Error("the block must open with a blank line, not weld itself to the last line of the file")
	}
}
