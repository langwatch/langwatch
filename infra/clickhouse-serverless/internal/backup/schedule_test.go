package backup

import (
	"testing"
	"time"
)

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestSchedule(t *testing.T) {
	for _, tc := range []struct {
		expr, from, next, prev string
	}{
		// The production cadence: a full every third day at 05:00, hourly incrementals at :30.
		{"0 5 */3 * *", "2026-10-23T12:00:00Z", "2026-10-25T05:00:00Z", "2026-10-22T05:00:00Z"},
		{"30 * * * *", "2026-10-23T12:30:00Z", "2026-10-23T13:30:00Z", "2026-10-23T12:30:00Z"},
		{"0 */12 * * *", "2026-10-23T11:59:00Z", "2026-10-23T12:00:00Z", "2026-10-23T00:00:00Z"},
		{"15 2 * * 0", "2026-10-23T00:00:00Z", "2026-10-25T02:15:00Z", "2026-10-18T02:15:00Z"},
		{"15 2 * * 7", "2026-10-23T00:00:00Z", "2026-10-25T02:15:00Z", "2026-10-18T02:15:00Z"},
		{"0 0 1 1 *", "2026-10-23T00:00:00Z", "2027-01-01T00:00:00Z", "2026-01-01T00:00:00Z"},
		{"0,30 9-10 * * 1-5", "2026-10-23T10:31:00Z", "2026-10-26T09:00:00Z", "2026-10-23T10:30:00Z"},
		// Both day fields restricted: either matches (13th, or a Friday).
		{"0 0 13 * 5", "2026-10-10T00:00:00Z", "2026-10-13T00:00:00Z", "2026-10-09T00:00:00Z"},
		{"0 0 29 2 *", "2026-03-01T00:00:00Z", "2028-02-29T00:00:00Z", "2024-02-29T00:00:00Z"},
	} {
		s, err := ParseSchedule(tc.expr)
		if err != nil {
			t.Fatalf("%s: %v", tc.expr, err)
		}
		if got, _ := s.Next(at(tc.from)); !got.Equal(at(tc.next)) {
			t.Errorf("%s Next(%s) = %s, want %s", tc.expr, tc.from, got, tc.next)
		}
		if got, _ := s.Prev(at(tc.from)); !got.Equal(at(tc.prev)) {
			t.Errorf("%s Prev(%s) = %s, want %s", tc.expr, tc.from, got, tc.prev)
		}
	}
	for _, bad := range []string{"", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "*/0 * * * *", "5-1 * * * *", "0 0 30 2 *", "a * * * *"} {
		if _, err := ParseSchedule(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

// @scenario "A scheduled firing is owed until a backup of its mode completes after it"
func TestDue(t *testing.T) {
	s, _ := ParseSchedule("30 * * * *")
	fire := at("2026-10-23T12:30:00Z")
	n := at("2026-10-23T12:30:20Z")

	if _, due := Due(s, n, at("2026-10-23T11:31:00Z"), Slot{}); !due {
		t.Error("a firing with no backup since should be owed")
	}
	if _, due := Due(s, n, at("2026-10-23T12:30:10Z"), Slot{}); due {
		t.Error("a backup completed after the firing, by anyone, covers it")
	}
	// A restart across a firing catches up: the slot is unknown, nothing completed.
	if _, due := Due(s, at("2026-10-23T12:55:00Z"), at("2026-10-23T11:31:00Z"), Slot{}); !due {
		t.Error("a restart after a firing should catch it up")
	}

	ran := Slot{}.Record(fire, n, false)
	if _, due := Due(s, n.Add(time.Minute), time.Time{}, ran); due {
		t.Error("a run in progress or stood down owes no second run")
	}
	failed := Slot{}.Record(fire, n, true)
	if _, due := Due(s, n.Add(RetryAfter-time.Second), time.Time{}, failed); due {
		t.Error("a failed slot retries only after RetryAfter")
	}
	if _, due := Due(s, n.Add(RetryAfter), time.Time{}, failed); !due {
		t.Error("a failed slot retries once")
	}
	twice := failed.Record(fire, n.Add(RetryAfter), true)
	if _, due := Due(s, n.Add(2*RetryAfter), time.Time{}, twice); due {
		t.Error("a slot gets at most MaxTries runs")
	}
	// The next firing starts afresh.
	if _, due := Due(s, at("2026-10-23T13:30:05Z"), time.Time{}, twice); !due {
		t.Error("the next firing should be owed again")
	}
}

// @scenario "Exactly one replica runs backups, failing over to the next that answers"
func TestElect(t *testing.T) {
	all := []int{0, 1, 2}
	for _, tc := range []struct {
		name      string
		reachable []int
		preferred int
		want      int
	}{
		{"preferred answers", all, 1, 1},
		{"preferred down: the next", []int{0, 2}, 1, 2},
		{"wraps", []int{0}, 1, 0},
		{"out of range wraps", all, 4, 1},
		{"none answers", nil, 0, -1},
	} {
		if got := Elect(Replicas{Total: 3, Reachable: tc.reachable}, tc.preferred); got != tc.want {
			t.Errorf("%s: Elect = %d, want %d", tc.name, got, tc.want)
		}
	}

	// Every server with the same view picks the same single runner.
	runners := 0
	for self := 0; self < 3; self++ {
		if IsRunner(Replicas{Total: 3, Self: self, Reachable: []int{0, 2}}, 1, nil) {
			runners++
		}
	}
	if runners != 1 {
		t.Errorf("%d runners, want exactly one", runners)
	}
	// A server that cannot see its peers runs only if it is the preferred one.
	if IsRunner(Replicas{Total: 3, Self: 2}, 1, errBoom) {
		t.Error("a blind non-preferred server elected itself")
	}
	if !IsRunner(Replicas{Total: 3, Self: 1}, 1, errBoom) {
		t.Error("the blind preferred server should keep running")
	}
	if !IsRunner(Replicas{Total: 1, Self: 0, Reachable: []int{0}}, 0, nil) {
		t.Error("a single server is its own runner")
	}
}
