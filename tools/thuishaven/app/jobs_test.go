package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/jobscratch"
)

// jobFixture is one job directory written into a temp jobs root: what its
// state.json says, how long ago its files were touched, and whether a live
// process is holding it.
type jobFixture struct {
	id      string
	state   string
	touched time.Duration // how long ago the whole directory was last written and read
	inProc  bool          // a live process's command line names this job
	isOwn   bool          // haven itself was launched from this job
}

// writeJob lays a job directory out the way a real one is: the two record files
// plus a tmp/ tree standing in for the scratch that fills the disk. Both
// timestamps are set together, because the age rule only fires when neither has
// moved.
func writeJob(t *testing.T, root string, f jobFixture, now time.Time) string {
	t.Helper()
	dir := filepath.Join(root, f.id)
	scratch := filepath.Join(dir, "tmp", "nested")
	if err := os.MkdirAll(scratch, 0o755); err != nil {
		t.Fatalf("mkdir job: %v", err)
	}
	files := map[string]string{
		filepath.Join(dir, "state.json"):       `{"state":"` + f.state + `","name":"lane ` + f.id + `"}`,
		filepath.Join(dir, "timeline.jsonl"):   "{\"t\":1}\n",
		filepath.Join(dir, "run.log"):          "noise\n",
		filepath.Join(scratch, "artifact.bin"): "0123456789",
	}
	for path, body := range files {
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
	// Stamp deepest-first: writing a file updates its parent directory's mtime,
	// so stamping a directory before its children would be undone immediately.
	stamp := now.Add(-f.touched)
	for _, path := range []string{
		filepath.Join(scratch, "artifact.bin"), scratch, filepath.Join(dir, "tmp"),
		filepath.Join(dir, "run.log"), filepath.Join(dir, "timeline.jsonl"),
		filepath.Join(dir, "state.json"), dir,
	} {
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatalf("chtimes %s: %v", path, err)
		}
	}
	return dir
}

// jobsOrch wires the real jobscratch adapter over a temp jobs root, so these
// tests exercise the state.json parse, the timestamp walk and the keep-list
// rather than a fake that would agree with the app by construction.
func jobsOrch(t *testing.T, now time.Time, fixtures []jobFixture) (*Orchestrator, map[string]string) {
	t.Helper()
	root := t.TempDir()
	dirs := map[string]string{}
	var samples []ProcessSample
	var own []string
	for _, f := range fixtures {
		dir := writeJob(t, root, f, now)
		dirs[f.id] = dir
		if f.inProc {
			samples = append(samples, ProcessSample{PID: 9, Command: "claude --job " + f.id + " --resume"})
		}
		if f.isOwn {
			own = append(own, dir)
		}
	}
	o := &Orchestrator{
		cfg:   Config{JobsRoot: root, OwnJobDirs: own},
		store: &fakeStore{},
		sys:   &fakeSystem{now: now, procSamples: samples},
		jobs:  jobscratch.New(),
		log:   zap.NewNop(),
	}
	return o, dirs
}

func planned(t *testing.T, o *Orchestrator, id string) JobRow {
	t.Helper()
	rows, err := o.PlanJobs()
	if err != nil {
		t.Fatalf("PlanJobs: %v", err)
	}
	for _, r := range rows {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("job %q was not planned at all", id)
	return JobRow{}
}

// @scenario "A job untouched for a week is reclaimed whatever its state says"
// @scenario "A job a live process is working in is kept"
// @scenario "The job haven was launched from is never reclaimed"
func TestClassifyingAgentJobs(t *testing.T) {
	now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name    string
		fixture jobFixture
		want    bool
	}{
		{
			name:    "given a job whose state says done",
			fixture: jobFixture{id: "done1", state: "done", touched: time.Hour},
			want:    true,
		},
		{
			name:    "given a job the operator stopped",
			fixture: jobFixture{id: "stopped1", state: "stopped", touched: time.Hour},
			want:    true,
		},
		{
			name:    "given a job that failed",
			fixture: jobFixture{id: "failed1", state: "failed", touched: time.Hour},
			want:    true,
		},
		{
			name:    "given a job still blocked, touched this morning",
			fixture: jobFixture{id: "blocked1", state: "blocked", touched: time.Hour},
			want:    false,
		},
		{
			name:    "given a blocked job neither written nor read for eight days",
			fixture: jobFixture{id: "cold1", state: "blocked", touched: 8 * 24 * time.Hour},
			want:    true,
		},
		{
			name:    "given a finished job a live process still names",
			fixture: jobFixture{id: "busy1", state: "done", touched: time.Hour, inProc: true},
			want:    false,
		},
		{
			name:    "given the finished job haven itself was launched from",
			fixture: jobFixture{id: "self1", state: "done", touched: time.Hour, isOwn: true},
			want:    false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			o, _ := jobsOrch(t, now, []jobFixture{tc.fixture})

			t.Run("when haven classifies the jobs", func(t *testing.T) {
				row := planned(t, o, tc.fixture.id)
				if row.Reclaimable != tc.want {
					t.Fatalf("reclaimable = %v (%q), want %v", row.Reclaimable, row.Reason, tc.want)
				}
				if row.Reason == "" {
					t.Error("every verdict must carry the reason the operator reads")
				}
			})
		})
	}
}

// @scenario "A finished job's scratch is reclaimed and its record is kept"
func TestReclaimingAJobKeepsItsRecord(t *testing.T) {
	now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)
	o, dirs := jobsOrch(t, now, []jobFixture{
		{id: "done1", state: "done", touched: time.Hour},
		{id: "busy1", state: "done", touched: time.Hour, inProc: true},
	})

	t.Run("given a finished job holding a record and a scratch tree", func(t *testing.T) {
		t.Run("when haven reclaims the reclaimable jobs", func(t *testing.T) {
			var freedTotal int64
			errs := map[string]error{}
			o.ReclaimJobs([]string{dirs["done1"], dirs["busy1"]}, func(dir string, freed int64, err error) {
				freedTotal += freed
				errs[dir] = err
			})

			t.Run("the record survives and the scratch is gone", func(t *testing.T) {
				// Named here rather than read from domain.JobRecordFiles: an
				// assertion driven by the same list the code deletes from would
				// shrink with it and prove nothing.
				for _, keep := range []string{"state.json", "timeline.jsonl"} {
					if _, err := os.Stat(filepath.Join(dirs["done1"], keep)); err != nil {
						t.Errorf("%s must survive a reclaim: %v", keep, err)
					}
				}
				for _, gone := range []string{"tmp", "run.log"} {
					if _, err := os.Stat(filepath.Join(dirs["done1"], gone)); !os.IsNotExist(err) {
						t.Errorf("%s should have been reclaimed, stat gave %v", gone, err)
					}
				}
				if freedTotal <= 0 {
					t.Error("a reclaim must report the bytes it freed")
				}
			})

			t.Run("the job a live process holds is refused, not quietly skipped", func(t *testing.T) {
				if errs[dirs["busy1"]] == nil {
					t.Error("reclaiming a job in use must be refused so the caller sees it did not happen")
				}
				if _, err := os.Stat(filepath.Join(dirs["busy1"], "tmp")); err != nil {
					t.Errorf("the busy job's scratch must be untouched: %v", err)
				}
			})

			t.Run("the reclaim is recorded for the hub feed", func(t *testing.T) {
				events := o.store.ReapEvents()
				if len(events) != 1 || events[0].Kind != "jobscratch" || events[0].Target != "done1" {
					t.Errorf("expected one recorded jobscratch reap for done1, got %+v", events)
				}
			})
		})
	})
}

// @scenario "The daemon removes the classified worktrees and leaves their databases"
func TestTheDaemonReclaimsFinishedJobScratch(t *testing.T) {
	now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)
	o, dirs := jobsOrch(t, now, []jobFixture{
		{id: "done1", state: "done", touched: time.Hour},
		{id: "live1", state: "blocked", touched: time.Hour},
	})

	t.Run("given one finished job and one still active", func(t *testing.T) {
		t.Run("when the daemon runs its daily disk reclaim", func(t *testing.T) {
			o.reapJobScratch()

			if _, err := os.Stat(filepath.Join(dirs["done1"], "tmp")); !os.IsNotExist(err) {
				t.Errorf("the finished job's scratch should be gone, stat gave %v", err)
			}
			if _, err := os.Stat(filepath.Join(dirs["live1"], "tmp")); err != nil {
				t.Errorf("an active job must be left entirely alone: %v", err)
			}
		})
	})
}

// ScanJobSizes must never size a job it cannot offer: a `du` over a job in use
// is work nobody can act on, and on a machine with two hundred jobs it is the
// difference between a fast plan and a stalled one.
func TestSizingSkipsJobsThatAreNotReclaimable(t *testing.T) {
	now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)
	o, _ := jobsOrch(t, now, []jobFixture{
		{id: "done1", state: "done", touched: time.Hour},
		{id: "busy1", state: "done", touched: time.Hour, inProc: true},
	})
	rows, err := o.PlanJobs()
	if err != nil {
		t.Fatalf("PlanJobs: %v", err)
	}

	sized := map[string]bool{}
	o.ScanJobSizes(context.Background(), rows, func(i int, bytes int64) {
		if bytes <= 0 {
			t.Errorf("a reported size must be a real measurement, got %d", bytes)
		}
		sized[rows[i].ID] = true
	})
	if !sized["done1"] {
		t.Error("the reclaimable job must be sized")
	}
	if sized["busy1"] {
		t.Error("a job in use must never be sized")
	}
}
