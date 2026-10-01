package domain

import (
	"strings"
	"testing"
)

// @scenario "A finished cleanup counts and sizes each kind on its own"
func TestReclaimTallyKeepsTheKindsApart(t *testing.T) {
	t.Run("given a run that reclaimed job scratch and worktrees", func(t *testing.T) {
		var tally ReclaimTally
		tally.AddMany(JobScratchKind, 158, 2_100_000_000)
		tally.Add(WorktreeKind, 400_000_000)
		tally.Add(WorktreeKind, 100_000_000)
		tally.Kept(WorktreeKind)

		t.Run("when it reports what it freed", func(t *testing.T) {
			got := tally.Summary()

			for _, want := range []string{"158 job scratch dirs", "2 worktrees", "1 worktree kept"} {
				if !strings.Contains(got, want) {
					t.Errorf("summary %q should say %q — each kind counted on its own", got, want)
				}
			}
			// 2.1 GB of job scratch must never be reported against the worktrees,
			// which is what a single merged total would have done.
			jobs, worktrees, _ := strings.Cut(got, ";")
			if !strings.Contains(jobs, "job scratch") || strings.Contains(jobs, "worktree") {
				t.Errorf("the first clause should be job scratch alone, got %q", jobs)
			}
			if strings.Contains(worktrees, HumanBytes(2_100_000_000)) {
				t.Errorf("job scratch bytes leaked into the worktree clause: %q", worktrees)
			}
			if !strings.Contains(worktrees, HumanBytes(500_000_000)) {
				t.Errorf("the worktree clause should carry only its own 500 MB, got %q", worktrees)
			}
		})
	})

	t.Run("given a run that reclaimed nothing", func(t *testing.T) {
		t.Run("when it reports, it says so rather than printing an empty sentence", func(t *testing.T) {
			var tally ReclaimTally
			if got := tally.Summary(); got != "reclaimed nothing" {
				t.Errorf("empty summary = %q", got)
			}
		})
	})
}

// A count that reads "1 worktrees" is the tell that the noun was pasted in
// rather than chosen, and these strings go on every progress line.
func TestReclaimKindCountsInWholeWords(t *testing.T) {
	if got := WorktreeKind.Count(1); got != "1 worktree" {
		t.Errorf("Count(1) = %q", got)
	}
	if got := JobScratchKind.Count(187); got != "187 job scratch dirs" {
		t.Errorf("Count(187) = %q", got)
	}
}
