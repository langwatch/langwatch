package domain

import (
	"slices"
	"strings"
	"testing"
	"time"
)

// @scenario "A worktree whose path holds dots and dashes still matches its transcripts"
func TestClaudeProjectSlugEncodesForward(t *testing.T) {
	t.Run("given a worktree inside a dot directory with hyphenated names", func(t *testing.T) {
		dir := "/Users/lw/Source/github.com/langwatch/langwatch/.claude/worktrees/cli-ollama"

		t.Run("when its transcript directory is named", func(t *testing.T) {
			got := ClaudeProjectSlug(dir)
			want := "-Users-lw-Source-github-com-langwatch-langwatch--claude-worktrees-cli-ollama"
			if got != want {
				t.Errorf("ClaudeProjectSlug(%q)\n got %q\nwant %q", dir, got, want)
			}
		})
	})

	// The encoding folds three different characters onto one, so two paths can
	// share a slug and no slug names one path. Anything that tried to read a
	// worktree back out of a directory name would be guessing.
	t.Run("given two paths that differ only in characters the encoding folds", func(t *testing.T) {
		if ClaudeProjectSlug("/a/b-c") != ClaudeProjectSlug("/a/b.c") {
			t.Fatal("expected the encoding to be lossy, so linking must encode forward and compare")
		}
	})

	t.Run("given a trailing separator", func(t *testing.T) {
		if got, want := ClaudeProjectSlug("/tmp/wt/"), ClaudeProjectSlug("/tmp/wt"); got != want {
			t.Errorf("a trailing slash changed the slug: %q vs %q", got, want)
		}
	})
}

// @scenario "Old and large is the only thing worth interrupting for"
func TestClaudeStateNoticeNeedsBothAgeAndWeight(t *testing.T) {
	big := int64(4 << 30)

	t.Run("given a directory that is large but written to this morning", func(t *testing.T) {
		v := ClassifyClaudeState(ClaudeStateFacts{
			ClaudeStateRecord: ClaudeStateRecord{Name: "cache", Bytes: big, ColdBytes: 0, Newest: time.Now()},
			Scope:             ClaudeScopeMachine,
		})
		if v.Notice != "" {
			t.Errorf("current bytes should say nothing, got %q", v.Notice)
		}
	})

	t.Run("given a directory that is old but tiny", func(t *testing.T) {
		v := ClassifyClaudeState(ClaudeStateFacts{
			ClaudeStateRecord: ClaudeStateRecord{Name: "sessions", Bytes: 40 << 10, ColdBytes: 40 << 10},
			Scope:             ClaudeScopeSession,
		})
		if v.Notice != "" {
			t.Errorf("40 KB of old files is not worth a line, got %q", v.Notice)
		}
	})

	t.Run("given a directory holding a gigabyte nobody has touched in months", func(t *testing.T) {
		v := ClassifyClaudeState(ClaudeStateFacts{
			ClaudeStateRecord: ClaudeStateRecord{Name: "projects", Bytes: 2 << 30, ColdBytes: 1 << 30},
			Scope:             ClaudeScopeWorktree,
		})
		if !strings.Contains(v.Notice, HumanBytes(1<<30)) || !strings.Contains(v.Notice, "90d") {
			t.Errorf("notice should name the cold weight and how long it has sat, got %q", v.Notice)
		}
	})
}

// @scenario "A directory still in daily use is judged on the age of its bytes, not its own mtime"
func TestClaudeStateJudgesTheBytesNotTheDirectory(t *testing.T) {
	t.Run("given transcripts written to today whose files are mostly a year old", func(t *testing.T) {
		facts := ClaudeStateFacts{
			ClaudeStateRecord: ClaudeStateRecord{
				Name:      "-Users-lw-Source-langwatch",
				Bytes:     1300 << 20,
				ColdBytes: 900 << 20,
				Newest:    time.Now(),
			},
			Scope:       ClaudeScopeWorktree,
			WorktreeDir: "/Users/lw/Source/langwatch",
			Slugged:     true,
		}

		t.Run("when haven decides what to say", func(t *testing.T) {
			v := ClassifyClaudeState(facts)
			if !v.Linked {
				t.Error("a directory whose worktree is on disk is linked to it")
			}
			if v.LeftBehind {
				t.Error("a live worktree's transcripts are not left behind")
			}
			if !strings.Contains(v.Notice, HumanBytes(900<<20)) {
				t.Errorf("notice should name the cold share, not the total, got %q", v.Notice)
			}
			if strings.Contains(v.Notice, HumanBytes(1300<<20)) {
				t.Errorf("a directory written to today is not wholly old: %q", v.Notice)
			}
		})
	})
}

// @scenario "Transcripts whose worktree is gone are reported as left behind"
// @scenario "A gone worktree that left almost nothing is counted, not listed"
func TestClaudeStateReportsWhatAGoneWorktreeLeft(t *testing.T) {
	t.Run("given a transcript directory naming a path that no longer exists", func(t *testing.T) {
		v := ClassifyClaudeState(ClaudeStateFacts{
			ClaudeStateRecord: ClaudeStateRecord{Name: "-tmp-gone", Bytes: 400 << 20},
			Scope:             ClaudeScopeWorktree,
			Slugged:           true,
		})
		if !v.LeftBehind || v.Linked {
			t.Fatalf("expected left behind and unlinked, got %+v", v)
		}
		if !strings.Contains(v.Notice, "worktree gone") || !strings.Contains(v.Notice, HumanBytes(400<<20)) {
			t.Errorf("notice should say the worktree is gone and how much is still there, got %q", v.Notice)
		}
	})

	// A test sandbox that left forty kilobytes behind is true and worthless.
	// Thirty of those lines above the gigabyte that matters is how a report
	// stops being read.
	t.Run("given a gone worktree that left almost nothing", func(t *testing.T) {
		v := ClassifyClaudeState(ClaudeStateFacts{
			ClaudeStateRecord: ClaudeStateRecord{Name: "-tmp-sandbox", Bytes: 40 << 10},
			Scope:             ClaudeScopeWorktree,
			Slugged:           true,
		})
		if !v.LeftBehind {
			t.Error("it is still left behind")
		}
		if v.Notice != "" {
			t.Errorf("but it is not worth a line of its own, got %q", v.Notice)
		}
	})

	// Session-keyed directories never encoded a path, so they cannot have lost
	// one — calling them left behind would report every machine as broken.
	t.Run("given a session-keyed directory with no worktree", func(t *testing.T) {
		v := ClassifyClaudeState(ClaudeStateFacts{
			ClaudeStateRecord: ClaudeStateRecord{Name: "file-history", Bytes: 25 << 20},
			Scope:             ClaudeScopeSession,
		})
		if v.LeftBehind || v.Notice != "" {
			t.Errorf("an unslugged directory is not left behind, got %+v", v)
		}
	})
}

// @scenario "Session-keyed and machine-wide state is named but attributed to no worktree"
// @scenario "The two locations haven already reclaims are not counted twice"
func TestClaudeLocationCatalog(t *testing.T) {
	t.Run("given the catalog of locations", func(t *testing.T) {
		byName := map[string]ClaudeLocation{}
		for _, loc := range ClaudeLocations {
			if loc.Holds == "" {
				t.Errorf("%q is listed without saying what it holds", loc.Name)
			}
			if _, dup := byName[loc.Name]; dup {
				t.Errorf("%q is listed twice", loc.Name)
			}
			byName[loc.Name] = loc
		}

		t.Run("when a session-keyed or machine-wide directory is read", func(t *testing.T) {
			for _, name := range []string{"file-history", "shell-snapshots", "plugins", "cache"} {
				loc, ok := byName[name]
				if !ok {
					t.Fatalf("%q is not in the catalog", name)
				}
				if loc.Scope == ClaudeScopeWorktree {
					t.Errorf("%q is not keyed by a worktree path, so it must not claim one", name)
				}
			}
		})

		t.Run("when the directories a cleanup already owns are considered", func(t *testing.T) {
			for _, owned := range ClaudeReclaimedLocations {
				if _, listed := byName[owned]; listed {
					t.Errorf("%q is reclaimed by its own picker — listing it here counts it twice", owned)
				}
			}
			if !slices.Contains(ClaudeReclaimedLocations, "jobs") {
				t.Error("job scratch is the largest thing under the Claude home; it must be named as already owned")
			}
		})

		t.Run("when transcripts are read", func(t *testing.T) {
			projects, ok := byName["projects"]
			if !ok || !projects.PerEntry || projects.Scope != ClaudeScopeWorktree {
				t.Errorf("transcripts are per-worktree and reported per entry, got %+v", projects)
			}
		})
	})
}
