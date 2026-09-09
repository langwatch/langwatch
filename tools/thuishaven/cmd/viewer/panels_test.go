package viewer

import (
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// @scenario "Stores shows each server against its limit"
func TestStoresShowsEachServerAgainstItsLimit(t *testing.T) {
	const gigabyte = 1 << 30
	stores := &sources.MemoryStores{StoreStats: []sources.StoreStat{
		{Name: "postgres", Measure: "connections", Used: 24, Limit: 100},
		{Name: "redis", Measure: "memory", Unit: "bytes", Used: 0.5 * gigabyte, Limit: gigabyte},
		{Name: "clickhouse", Measure: "memory", Unit: "bytes", Used: 0.95 * gigabyte, Limit: gigabyte},
	}}
	tab := NewStoresTab(Sources{Stores: stores, Now: time.Now})
	tab.Poll()
	body := tab.Body(Frame{Width: 140, Height: 20})
	if len(body) != 3 {
		t.Fatalf("body = %d rows, want one per managed server", len(body))
	}

	cases := []struct {
		row  int
		want []string
	}{
		{row: 0, want: []string{"postgres", "connections", "24", "100"}},
		{row: 1, want: []string{"redis", "memory", "512.0 MB", "1.0 GB"}},
		{row: 2, want: []string{"clickhouse", "memory", "972.8 MB", "1.0 GB"}},
	}
	for _, tc := range cases {
		for _, want := range tc.want {
			if !strings.Contains(body[tc.row], want) {
				t.Errorf("row %d = %q, want it to contain %q", tc.row, body[tc.row], want)
			}
		}
	}

	t.Run("when a server is past ninety percent of its limit", func(t *testing.T) {
		if !strings.Contains(body[2], "% of the limit") {
			t.Errorf("clickhouse row = %q, want it marked at 95%% of the limit", body[2])
		}
		for _, row := range body[:2] {
			if strings.Contains(row, "% of the limit") {
				t.Errorf("row %q is marked below the threshold", row)
			}
		}
	})
}

// @scenario "Jobs is the history of the one-shot lanes"
func TestJobsIsTheHistoryOfTheOneShotLanes(t *testing.T) {
	now := time.Now()
	jobs := &sources.MemoryJobs{History: []sources.JobRun{
		{Name: "prepare", At: now.Add(-4 * time.Minute), Duration: 22 * time.Second},
		{Name: "seed", At: now.Add(-3 * time.Minute), Duration: 9 * time.Second, Exit: 1},
		{Name: "langy-image", At: now.Add(-2 * time.Minute), Duration: 95 * time.Second,
			Output: []string{"pulling ghcr.io/langwatch/langyagent", "pulled"}},
	}}
	tab := NewJobsTab(Sources{Jobs: jobs, Now: func() time.Time { return now }})
	tab.Poll()
	body := tab.Body(Frame{Width: 140, Height: 20})
	if len(body) != 3 {
		t.Fatalf("body = %d rows, want one per job that ran", len(body))
	}

	cases := []struct {
		row  int
		want []string
	}{
		{row: 0, want: []string{"prepare", "4m00s ago", "22.0s", "ok"}},
		{row: 1, want: []string{"seed", "3m00s ago", "9.0s", "exit 1"}},
		{row: 2, want: []string{"langy-image", "2m00s ago", "1m35s", "ok"}},
	}
	for _, tc := range cases {
		for _, want := range tc.want {
			if !strings.Contains(body[tc.row], want) {
				t.Errorf("row %d = %q, want it to contain %q", tc.row, body[tc.row], want)
			}
		}
	}

	t.Run("when the developer presses enter on a job", func(t *testing.T) {
		tab.Key("down")
		tab.Key("down")
		if !tab.Key("enter") {
			t.Fatal("enter was not claimed by the jobs tab")
		}
		output := strings.Join(tab.Body(Frame{Width: 140, Height: 20}), "\n")
		if !strings.Contains(output, "pulling ghcr.io/langwatch/langyagent") {
			t.Errorf("drill-in = %q, want that job's captured output", output)
		}
	})
}
