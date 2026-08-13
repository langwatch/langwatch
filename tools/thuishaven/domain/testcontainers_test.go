package domain

import (
	"testing"
	"time"
)

func TestParseTestContainerListing(t *testing.T) {
	t.Run("when the runtime lists two containers and a blank line", func(t *testing.T) {
		out := "abc123\t2026-08-11 14:23:45 +0200 CEST\tlucid_goodall\n" +
			"def456\t2026-08-13 09:00:00 +0200 CEST\tlaughing_meitner\n\n"

		containers := ParseTestContainerListing(out)

		if len(containers) != 2 {
			t.Fatalf("expected 2 containers, got %d", len(containers))
		}
		if containers[0].ID != "abc123" || containers[0].Name != "lucid_goodall" {
			t.Errorf("first container = %+v, want abc123/lucid_goodall", containers[0])
		}
		if got := containers[0].CreatedAt.UTC(); got != time.Date(2026, 8, 11, 12, 23, 45, 0, time.UTC) {
			t.Errorf("first CreatedAt = %v, want the +0200 offset applied", got)
		}
	})

	t.Run("when a line cannot be dated it is dropped, not guessed at", func(t *testing.T) {
		out := "abc123\tnot-a-date\tmystery\n" +
			"def456\t2026-08-13 09:00:00 +0200 CEST\tlaughing_meitner\n" +
			"garbage-without-tabs\n"

		containers := ParseTestContainerListing(out)

		if len(containers) != 1 || containers[0].ID != "def456" {
			t.Fatalf("expected only the parseable container, got %+v", containers)
		}
	})
}

// @scenario "A fresh test container is left alone"
func TestLeakedTestContainers(t *testing.T) {
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	cutoff := now.Add(-time.Hour)

	t.Run("given one stale and one fresh container", func(t *testing.T) {
		containers := []TestContainer{
			{ID: "old", CreatedAt: now.Add(-2 * 24 * time.Hour)},
			{ID: "fresh", CreatedAt: now.Add(-5 * time.Minute)},
		}

		leaked := LeakedTestContainers(containers, cutoff)

		if len(leaked) != 1 || leaked[0].ID != "old" {
			t.Fatalf("expected only the stale container, got %+v", leaked)
		}
	})

	t.Run("given a container created exactly at the cutoff", func(t *testing.T) {
		leaked := LeakedTestContainers([]TestContainer{{ID: "edge", CreatedAt: cutoff}}, cutoff)
		if len(leaked) != 0 {
			t.Fatalf("a container at the cutoff is not yet leaked, got %+v", leaked)
		}
	})
}
