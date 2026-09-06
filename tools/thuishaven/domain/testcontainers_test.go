package domain

import (
	"testing"
	"time"
)

func TestParseTestContainerListing(t *testing.T) {
	t.Run("when the runtime lists two containers and a blank line", func(t *testing.T) {
		out := "abc123\trunning\t2026-08-11 14:23:45 +0200 CEST\tlucid_goodall\torg.testcontainers=true,org.testcontainers.lang=node\n" +
			"def456\texited\t2026-08-13 09:00:00 +0200 CEST\tlaughing_meitner\torg.testcontainers=true\n\n"

		containers, unparseable := ParseTestContainerListing(out)

		if unparseable != 0 {
			t.Fatalf("expected no unparseable lines, got %d", unparseable)
		}
		if len(containers) != 2 {
			t.Fatalf("expected 2 containers, got %d", len(containers))
		}
		first := containers[0]
		if first.ID != "abc123" || first.Name != "lucid_goodall" || first.State != "running" || first.IsRyuk {
			t.Errorf("first container = %+v, want abc123/lucid_goodall running non-ryuk", first)
		}
		if got := first.CreatedAt.UTC(); got != time.Date(2026, 8, 11, 12, 23, 45, 0, time.UTC) {
			t.Errorf("first CreatedAt = %v, want the +0200 offset applied", got)
		}
		if containers[1].State != "exited" {
			t.Errorf("second State = %q, want exited", containers[1].State)
		}
	})

	// @scenario "The test library's own reaper container is never touched"
	t.Run("when the listing includes the Ryuk reaper container", func(t *testing.T) {
		out := "ryu789\trunning\t2026-08-11 14:23:45 +0200 CEST\ttestcontainers-ryuk\torg.testcontainers=true,org.testcontainers.ryuk=true\n"

		containers, _ := ParseTestContainerListing(out)

		if len(containers) != 1 || !containers[0].IsRyuk {
			t.Fatalf("expected the row parsed and marked as Ryuk, got %+v", containers)
		}
	})

	t.Run("when a line cannot be dated it is dropped and counted, not guessed at", func(t *testing.T) {
		out := "abc123\trunning\tnot-a-date\tmystery\torg.testcontainers=true\n" +
			"def456\texited\t2026-08-13 09:00:00 +0200 CEST\tlaughing_meitner\torg.testcontainers=true\n" +
			"garbage-without-tabs\n"

		containers, unparseable := ParseTestContainerListing(out)

		if len(containers) != 1 || containers[0].ID != "def456" {
			t.Fatalf("expected only the parseable container, got %+v", containers)
		}
		if unparseable != 2 {
			t.Fatalf("expected 2 unparseable lines counted, got %d", unparseable)
		}
	})
}

// @scenario "A fresh test container is left alone"
func TestLeakedTestContainers(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	stoppedCutoff := now.Add(-10 * time.Minute)
	runningCutoff := now.Add(-2 * time.Hour)

	t.Run("given one stale and one fresh stopped container", func(t *testing.T) {
		containers := []TestContainer{
			{ID: "old", State: "exited", CreatedAt: now.Add(-2 * 24 * time.Hour)},
			{ID: "fresh", State: "exited", CreatedAt: now.Add(-5 * time.Minute)},
		}

		leaked := LeakedTestContainers(containers, stoppedCutoff, runningCutoff)

		if len(leaked) != 1 || leaked[0].ID != "old" {
			t.Fatalf("expected only the stale container, got %+v", leaked)
		}
	})

	// @scenario "A container still running is judged by the longer grace period"
	t.Run("given running containers on both sides of the running cutoff", func(t *testing.T) {
		containers := []TestContainer{
			// Older than the stopped cutoff but younger than the running one:
			// a reused container a live suite may be using right now.
			{ID: "in-use", State: "running", CreatedAt: now.Add(-time.Hour)},
			{ID: "leaked", State: "running", CreatedAt: now.Add(-2 * 24 * time.Hour)},
		}

		leaked := LeakedTestContainers(containers, stoppedCutoff, runningCutoff)

		if len(leaked) != 1 || leaked[0].ID != "leaked" {
			t.Fatalf("expected only the day-old running container, got %+v", leaked)
		}
	})

	t.Run("given paused and restarting containers older than the stopped cutoff", func(t *testing.T) {
		containers := []TestContainer{
			// Transient states may belong to a live run mid-transition, so the
			// short stopped cutoff applies only to terminal states.
			{ID: "paused", State: "paused", CreatedAt: now.Add(-time.Hour)},
			{ID: "mid-restart", State: "restarting", CreatedAt: now.Add(-time.Hour)},
			{ID: "long-dead", State: "dead", CreatedAt: now.Add(-time.Hour)},
		}

		leaked := LeakedTestContainers(containers, stoppedCutoff, runningCutoff)

		if len(leaked) != 1 || leaked[0].ID != "long-dead" {
			t.Fatalf("expected only the terminal-state container, got %+v", leaked)
		}
	})

	t.Run("given the Ryuk reaper older than every cutoff", func(t *testing.T) {
		containers := []TestContainer{
			{ID: "ryuk", State: "running", CreatedAt: now.Add(-30 * 24 * time.Hour), IsRyuk: true},
		}

		if leaked := LeakedTestContainers(containers, stoppedCutoff, runningCutoff); len(leaked) != 0 {
			t.Fatalf("Ryuk must never be a candidate, got %+v", leaked)
		}
	})

	t.Run("given a container created exactly at the cutoff", func(t *testing.T) {
		leaked := LeakedTestContainers([]TestContainer{{ID: "edge", State: "exited", CreatedAt: stoppedCutoff}}, stoppedCutoff, runningCutoff)
		if len(leaked) != 0 {
			t.Fatalf("a container at the cutoff is not yet leaked, got %+v", leaked)
		}
	})
}
