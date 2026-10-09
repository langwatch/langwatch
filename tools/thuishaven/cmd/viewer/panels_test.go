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
	body := texts(tab.Body(Frame{Width: 140, Height: 20}))
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
	body := texts(tab.Body(Frame{Width: 140, Height: 20}))
	if len(body) != 4 {
		t.Fatalf("body = %d rows, want one per job plus the failed one's reason", len(body))
	}

	cases := []struct {
		row  int
		want []string
	}{
		{row: 0, want: []string{"prepare", "4m00s ago", "22.0s", "ok"}},
		{row: 1, want: []string{"seed", "3m00s ago", "9.0s", "exit 1"}},
		{row: 3, want: []string{"langy-image", "2m00s ago", "1m35s", "ok"}},
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
		output := strings.Join(texts(tab.Body(Frame{Width: 140, Height: 20})), "\n")
		if !strings.Contains(output, "pulling ghcr.io/langwatch/langyagent") {
			t.Errorf("drill-in = %q, want that job's captured output", output)
		}
	})
}

// @scenario "A failed job says why on the list"
func TestAFailedJobSaysWhyOnTheList(t *testing.T) {
	now := time.Now()
	jobs := &sources.MemoryJobs{History: []sources.JobRun{
		{Name: "codegen", At: now.Add(-time.Minute), Duration: 3 * time.Second, Exit: 1, Output: []string{
			"Loaded Prisma config from prisma.config.ts.",
			"Error: ENOENT: no such file or directory, open '/Users/afr/langwatch/package.json'",
			// A tool that has already failed keeps printing: progress, a
			// summary, a shell epilogue. The last line written is not the line
			// that says why it stopped.
			"Generated 27 Langy skills",
			"",
			"   ",
		}},
		{Name: "seed", At: now, Duration: time.Second},
	}}
	tab := NewJobsTab(Sources{Jobs: jobs, Now: func() time.Time { return now }})
	tab.Poll()
	body := texts(tab.Body(Frame{Width: 200, Height: 20}))

	if len(body) != 3 {
		t.Fatalf("body = %d rows, want the failed row, its reason, and the run that worked", len(body))
	}
	if !strings.Contains(body[1], "ENOENT") {
		t.Errorf("reason row = %q, want the last line that reads as the failure", body[1])
	}
	if strings.Contains(body[1], "Generated 27") {
		t.Errorf("reason row = %q, want the failure rather than the last line written", body[1])
	}
	if strings.TrimSpace(stripSGR(body[1])) == "" {
		t.Error("the reason row is blank - trailing blank output was taken as the reason")
	}
	if strings.Contains(body[2], "ENOENT") {
		t.Errorf("row = %q, want the successful run to carry no reason line", body[2])
	}

	t.Run("given a failed run that said nothing at all", func(t *testing.T) {
		silent := &sources.MemoryJobs{History: []sources.JobRun{{Name: "prepare", At: now, Exit: 2}}}
		quiet := NewJobsTab(Sources{Jobs: silent, Now: func() time.Time { return now }})
		quiet.Poll()
		rows := texts(quiet.Body(Frame{Width: 200, Height: 20}))
		if len(rows) != 2 || !strings.Contains(rows[1], "no output captured") {
			t.Errorf("body = %q, want the row to say there is nothing to show", rows)
		}
	})
}

// @scenario "Square brackets move between services"
func TestBracketsMoveBetweenProfiledServices(t *testing.T) {
	profiles := &sources.MemoryProfiles{Services: []sources.ServiceProfile{
		{Service: "langwatch-app"}, {Service: "langwatch-worker"}, {Service: "langwatch-service-nlpgo"},
	}}
	tab := NewProfilesTab(Sources{Profiles: profiles, Now: time.Now})
	tab.Poll()

	if !tab.Key("]") || tab.Selected() != "langwatch-worker" {
		t.Fatalf("] landed on %q, want the second service", tab.Selected())
	}
	tab.Key("]")
	tab.Key("]")
	if tab.Selected() != "langwatch-app" {
		t.Errorf("] wrapped to %q, want the first service", tab.Selected())
	}
	tab.Key("[")
	if tab.Selected() != "langwatch-service-nlpgo" {
		t.Errorf("[ wrapped to %q, want the last service", tab.Selected())
	}
	tab.Key("down")
	if tab.Selected() != "langwatch-service-nlpgo" {
		t.Errorf("down moved past the end to %q, want the arrows to keep clamping", tab.Selected())
	}
	if !strings.Contains(tab.Footer(), "[ ] moves between services") {
		t.Errorf("footer = %q, want it to name the bracket keys", tab.Footer())
	}
}
