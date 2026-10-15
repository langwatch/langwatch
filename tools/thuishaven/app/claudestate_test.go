package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/claudestate"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// claudeFixture is one directory written into a fake Claude home or temp root:
// where it goes, what it weighs, and how long ago its files were written.
type claudeFixture struct {
	path    string // relative to the root it belongs to
	bytes   int
	written time.Duration // how long ago
}

// writeClaudeState lays the fixtures out under root and stamps each file, so
// the cold share is measured from real mtimes rather than from a fake that
// would agree with the classification by construction.
func writeClaudeState(t *testing.T, root string, fixtures []claudeFixture, now time.Time) {
	t.Helper()
	for _, f := range fixtures {
		path := filepath.Join(root, f.path, "content.jsonl")
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatalf("mkdir %s: %v", f.path, err)
		}
		if err := os.WriteFile(path, make([]byte, f.bytes), 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
		stamp := now.Add(-f.written)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatalf("chtimes %s: %v", path, err)
		}
	}
}

// claudeStateOrch wires the real reader over a temp home and temp root, with
// the given worktrees on disk as far as git is concerned.
func claudeStateOrch(t *testing.T, now time.Time, worktrees []Worktree) (*Orchestrator, string, string) {
	t.Helper()
	home, tmp := t.TempDir(), t.TempDir()
	return &Orchestrator{
		cfg:         Config{ClaudeHome: home, ClaudeTmp: tmp},
		sys:         &fakeSystem{now: now},
		hyg:         &fakeHygiene{worktrees: worktrees},
		claudeState: claudestate.New(),
		log:         zap.NewNop(),
	}, home, tmp
}

func rowNamed(rows []ClaudeStateRow, name string) (ClaudeStateRow, bool) {
	for i := range rows {
		if rows[i].Name == name {
			return rows[i], true
		}
	}
	return ClaudeStateRow{}, false
}

// @scenario "A project's transcripts are named by the worktree they came from"
// @scenario "Transcripts whose worktree is gone are reported as left behind"
func TestPlanClaudeStateLinksDirectoriesToWorktrees(t *testing.T) {
	now := time.Now()
	live := "/repo/.claude/worktrees/cli-ollama"
	o, home, _ := claudeStateOrch(t, now, []Worktree{{Dir: live, Branch: "feat/cli"}})
	writeClaudeState(t, home, []claudeFixture{
		{path: filepath.Join("projects", domain.ClaudeProjectSlug(live)), bytes: 4096, written: time.Hour},
		{path: filepath.Join("projects", domain.ClaudeProjectSlug("/repo/.claude/worktrees/gone")), bytes: 2048, written: 200 * 24 * time.Hour},
		{path: "shell-snapshots", bytes: 512, written: time.Hour},
	}, now)

	rows, err := o.PlanClaudeState(context.Background(), "/repo")
	if err != nil {
		t.Fatalf("PlanClaudeState: %v", err)
	}

	t.Run("when a transcript directory names a live worktree", func(t *testing.T) {
		row, ok := rowNamed(rows, domain.ClaudeProjectSlug(live))
		if !ok {
			t.Fatalf("no row for the live worktree's transcripts, got %d rows", len(rows))
		}
		if row.WorktreeDir != live || !row.Linked || row.LeftBehind {
			t.Errorf("expected the row linked to %s, got %+v", live, row.ClaudeStateVerdict)
		}
	})

	t.Run("when a transcript directory names a worktree that is gone", func(t *testing.T) {
		row, ok := rowNamed(rows, domain.ClaudeProjectSlug("/repo/.claude/worktrees/gone"))
		if !ok {
			t.Fatal("no row for the gone worktree's transcripts")
		}
		if !row.LeftBehind || row.Linked {
			t.Errorf("expected left behind and unlinked, got %+v", row.ClaudeStateVerdict)
		}
		if _, err := os.Stat(row.Dir); err != nil {
			t.Errorf("the report must not remove anything, but %s is gone: %v", row.Dir, err)
		}
	})

	t.Run("when a session-keyed directory is read", func(t *testing.T) {
		row, ok := rowNamed(rows, "shell-snapshots")
		if !ok {
			t.Fatal("no row for shell-snapshots")
		}
		if row.WorktreeDir != "" || row.LeftBehind {
			t.Errorf("a session-keyed directory belongs to no worktree, got %+v", row)
		}
	})
}

// @scenario "Claude's working files outside its home are read too"
// @scenario "Removing a worktree says what it left behind"
func TestClaudeStateOutsideTheHome(t *testing.T) {
	now := time.Now()
	live := "/repo"
	o, home, tmp := claudeStateOrch(t, now, []Worktree{{Dir: live, Branch: "main"}})
	writeClaudeState(t, home, []claudeFixture{
		{path: filepath.Join("projects", domain.ClaudeProjectSlug(live)), bytes: 4096, written: time.Hour},
	}, now)
	writeClaudeState(t, tmp, []claudeFixture{
		{path: domain.ClaudeProjectSlug(live), bytes: 8192, written: time.Hour},
		{path: "bundled-skills", bytes: 1024, written: time.Hour},
	}, now)

	t.Run("when the temp root is planned", func(t *testing.T) {
		rows, err := o.PlanClaudeState(context.Background(), "/repo")
		if err != nil {
			t.Fatalf("PlanClaudeState: %v", err)
		}
		row, ok := rowNamed(rows, domain.ClaudeProjectSlug(live))
		if !ok {
			t.Fatal("the temp root's per-project directory was not reported")
		}
		if row.WorktreeDir != live {
			t.Errorf("a slugged directory in the temp root belongs to its worktree, got %q", row.WorktreeDir)
		}

		// bundled-skills sits beside the project directories and never encoded a
		// path; attributing it to a worktree would be a guess.
		skills, ok := rowNamed(rows, "bundled-skills")
		if !ok {
			t.Fatal("bundled-skills was not reported")
		}
		if skills.WorktreeDir != "" || skills.LeftBehind || skills.Scope != domain.ClaudeScopeMachine {
			t.Errorf("a name that is not an encoded path belongs to the installation, got %+v", skills)
		}
	})

	t.Run("when that worktree is removed", func(t *testing.T) {
		left := o.ClaudeStateLeftBy(context.Background(), live)
		if len(left) != 2 {
			t.Fatalf("both the transcripts and the temp working files are left behind, got %d: %+v", len(left), left)
		}
		var total int64
		for _, rec := range left {
			total += rec.Bytes
			if _, err := os.Stat(rec.Dir); err != nil {
				t.Errorf("reporting what was left behind must not remove it: %v", err)
			}
		}
		if total != 4096+8192 {
			t.Errorf("left-behind weight = %d, want %d", total, 4096+8192)
		}
	})

	t.Run("when a worktree has nothing left behind", func(t *testing.T) {
		if left := o.ClaudeStateLeftBy(context.Background(), "/repo/never-used"); len(left) != 0 {
			t.Errorf("expected nothing, got %+v", left)
		}
	})
}

// @scenario "The two locations haven already reclaims are not counted twice"
func TestPlanClaudeStateSkipsWhatACleanupAlreadyOwns(t *testing.T) {
	now := time.Now()
	o, home, _ := claudeStateOrch(t, now, nil)
	writeClaudeState(t, home, []claudeFixture{
		{path: filepath.Join("jobs", "ab12", "tmp"), bytes: 1 << 20, written: time.Hour},
		{path: filepath.Join("worktrees", "lane-a"), bytes: 1 << 20, written: time.Hour},
		{path: "cache", bytes: 4096, written: time.Hour},
	}, now)

	rows, err := o.PlanClaudeState(context.Background(), "/repo")
	if err != nil {
		t.Fatalf("PlanClaudeState: %v", err)
	}
	for _, row := range rows {
		for _, owned := range domain.ClaudeReclaimedLocations {
			if row.Name == owned {
				t.Errorf("%q has its own picker; counting it here double-counts the same gigabytes", owned)
			}
		}
	}
	if _, ok := rowNamed(rows, "cache"); !ok {
		t.Error("the cataloged locations should still be reported")
	}
}

// @scenario "The report deletes nothing and offers no picker"
func TestPlanClaudeStateIsReadOnly(t *testing.T) {
	now := time.Now()

	t.Run("given no Claude home and no temp root configured", func(t *testing.T) {
		o := &Orchestrator{cfg: Config{}, sys: &fakeSystem{now: now}, claudeState: claudestate.New(), log: zap.NewNop()}
		rows, err := o.PlanClaudeState(context.Background(), "/repo")
		if err != nil || rows != nil {
			t.Errorf("an unconfigured root reports nothing rather than walking the filesystem root: %v %+v", err, rows)
		}
	})

	t.Run("given a home that does not exist", func(t *testing.T) {
		o := &Orchestrator{
			cfg:         Config{ClaudeHome: filepath.Join(t.TempDir(), "absent")},
			sys:         &fakeSystem{now: now},
			hyg:         &fakeHygiene{},
			claudeState: claudestate.New(),
			log:         zap.NewNop(),
		}
		rows, err := o.PlanClaudeState(context.Background(), "/repo")
		if err != nil || len(rows) != 0 {
			t.Errorf("a machine that has never run Claude simply has nothing to report: %v %+v", err, rows)
		}
	})
}
