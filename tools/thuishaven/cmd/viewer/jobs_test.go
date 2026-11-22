package viewer

import (
	"fmt"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

func TestLatestRunsKeepsTheNewestRunOfEachJobAndItsTail(t *testing.T) {
	now := time.Now()
	long := make([]string, 30)
	for i := range long {
		long[i] = fmt.Sprintf("line %d", i)
	}
	jobs := &sources.MemoryJobs{History: []sources.JobRun{
		{Name: "prepare", At: now.Add(-4 * time.Minute), Exit: 1, Output: long},
		{Name: "seed", At: now.Add(-3 * time.Minute), Output: []string{"seeded"}},
		{Name: "prepare", At: now.Add(-2 * time.Minute), Output: long},
	}}
	tab := NewJobsTab(Sources{Jobs: jobs, Now: func() time.Time { return now }})
	tab.Poll()

	got := tab.LatestRuns(20)

	if len(got) != 2 || got[0].Name != "seed" || got[1].Name != "prepare" {
		t.Fatalf("runs = %+v, want seed then the newest prepare", got)
	}
	if got[1].Exit != 0 || len(got[1].Output) != 20 || got[1].Output[0] != "line 10" {
		t.Errorf("prepare = exit %d, %d lines from %q; want the newest run's last 20 lines", got[1].Exit, len(got[1].Output), got[1].Output[0])
	}
	if len(long) != 30 {
		t.Errorf("the journal's own output was trimmed")
	}
}

func BenchmarkLatestRuns(b *testing.B) {
	runs := make([]sources.JobRun, 0, 105)
	output := make([]string, 411)
	for i := range 105 {
		runs = append(runs, sources.JobRun{Name: fmt.Sprintf("job-%d", i%5), Output: output})
	}
	tab := NewJobsTab(Sources{Jobs: &sources.MemoryJobs{History: runs}})
	tab.Poll()
	b.ReportAllocs()
	for b.Loop() {
		_ = tab.LatestRuns(20)
	}
}
