package cmd

import (
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/prunetui"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// jobRow builds one planned job the way PlanJobs would, so these tests exercise
// the same classification the picker rows are built from.
func jobRow(id string, verdict domain.JobVerdict, age time.Duration) app.JobRow {
	return app.JobRow{
		JobRecord:  domain.JobRecord{ID: id, Dir: "/jobs/" + id, Name: "lane " + id},
		JobVerdict: verdict,
		Age:        age,
	}
}

// @scenario "The structured log never shares a stream with the progress render"
// @scenario "An agent's cleanup prints one line per item and no spinner"
func TestCleanOutputOwnership(t *testing.T) {
	cases := []struct {
		name       string
		isAgent    bool
		isTTY      bool
		unattended bool
		wantStream cleanStream
	}{
		{name: "given a person at a terminal", isTTY: true, wantStream: streamPicker},
		{name: "given an agent at a terminal", isAgent: true, isTTY: true, wantStream: streamPerItem},
		{name: "given a person with stdout piped elsewhere", wantStream: streamPerItem},
		{name: "given an unattended run at a terminal", isTTY: true, unattended: true, wantStream: streamPerItem},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Run("when haven decides who owns the output", func(t *testing.T) {
				out := decideCleanOutput(tc.isAgent, tc.isTTY, tc.unattended)

				if out.Stream != tc.wantStream {
					t.Errorf("stream = %v, want %v", out.Stream, tc.wantStream)
				}
				if out.LogFile == "" {
					t.Error("the structured log must always go to a file — never to the stream the progress or the per-item lines own")
				}
			})
		})
	}
}

// @scenario "Worktrees and job scratch are two lists, never one"
func TestThePickersAreTwoSeparateLists(t *testing.T) {
	worktrees := []app.PruneRow{
		{Dir: "/wt/a", Slug: "a", Branch: "feat/a"},
		{Dir: "/wt/b", Slug: "b", Branch: "feat/b"},
	}
	jobs := []app.JobRow{
		jobRow("cold1", domain.JobVerdict{Reclaimable: true, Cold: true, Reason: "finished (done)"}, 3*24*time.Hour),
		jobRow("busy1", domain.JobVerdict{Reason: "in use by a live process"}, time.Hour),
	}

	t.Run("given worktrees to prune and agent jobs to reclaim", func(t *testing.T) {
		t.Run("when the cleanup builds its pickers", func(t *testing.T) {
			wtRows := worktreePickerRows(worktrees)
			jobRows := jobPickerRows(jobs, app.ColdJobsOnly)

			for _, r := range wtRows {
				if r.Kind == prunetui.KindJob {
					t.Errorf("the worktree list holds a job row: %s", r.Dir)
				}
			}
			for _, r := range jobRows {
				if r.Kind != prunetui.KindJob {
					t.Errorf("the job list holds a worktree row: %s", r.Dir)
				}
			}
			if len(wtRows) != 2 {
				t.Errorf("every worktree is listed, got %d", len(wtRows))
			}
			// The job a live process holds is never reclaimable, so it is not
			// offered at all — the guard from the original reclaim, untouched.
			if len(jobRows) != 1 || jobRows[0].Dir != "/jobs/cold1" {
				t.Errorf("only the reclaimable job is offered, got %+v", jobRows)
			}
		})
	})
}

// @scenario "A job that finished this morning is not pre-ticked"
func TestOnlyColdJobsArePreTicked(t *testing.T) {
	cold := jobRow("cold1", domain.JobVerdict{Reclaimable: true, Cold: true, Reason: "finished (done)"}, 3*24*time.Hour)
	recent := jobRow("hot1", domain.JobVerdict{Reclaimable: true, Reason: "finished (done) 1h ago — recent"}, time.Hour)

	t.Run("given one cold job and one that finished an hour ago", func(t *testing.T) {
		t.Run("when the job picker is built with the default scope", func(t *testing.T) {
			rows := jobPickerRows([]app.JobRow{cold, recent}, app.ColdJobsOnly)
			byDir := map[string]prunetui.Row{}
			for _, r := range rows {
				byDir[r.Dir] = r
			}

			if !byDir["/jobs/cold1"].Preselect || !byDir["/jobs/cold1"].Deletable {
				t.Error("a cold job is pre-ticked and deletable")
			}
			if byDir["/jobs/hot1"].Preselect {
				t.Error("a job that finished an hour ago must never be pre-ticked")
			}
			if byDir["/jobs/hot1"].Deletable {
				t.Error("a recent job cannot be ticked at all without --include-recent")
			}
		})

		t.Run("when the operator asks for the recent ones by name", func(t *testing.T) {
			rows := jobPickerRows([]app.JobRow{cold, recent}, app.IncludeRecentJobs)
			for _, r := range rows {
				if r.Dir == "/jobs/hot1" {
					if !r.Deletable {
						t.Error("--include-recent is what makes a recent job tickable")
					}
					if r.Preselect {
						t.Error("--include-recent widens what can be ticked, it does not tick it for you")
					}
				}
			}
		})
	})
}
