package langyagent

import (
	"strings"
	"testing"
)

func TestWorkerUIDFor_Deterministic(t *testing.T) {
	// Same conversation id always maps to the same UID — the property the
	// chmod 0700 + spawn(uid) isolation relies on. If this drifts, an
	// existing per-session dir is no longer readable by its second turn.
	a := workerUIDFor("conv-abc")
	b := workerUIDFor("conv-abc")
	if a != b {
		t.Fatalf("expected same UID for same convId, got %d vs %d", a, b)
	}
}

func TestWorkerUIDFor_RangeBoundedAndAboveSystemReserved(t *testing.T) {
	// Spot-check a broad sample stays within [2000, 62000).
	for _, id := range []string{
		"a", "b", "conv-1", "conv-2", "conv-3",
		strings.Repeat("x", 64), strings.Repeat("y", 128),
		"cmaktest_abc", "x-y-z",
	} {
		u := workerUIDFor(id)
		if u < workerUIDBase || u >= workerUIDBase+workerUIDRange {
			t.Fatalf("uid %d for %q outside [%d, %d)", u, id, workerUIDBase, workerUIDBase+workerUIDRange)
		}
	}
}

func TestWorkerUIDFor_DifferentInputsSpread(t *testing.T) {
	// Two distinct conversation ids should almost-never collide. This is not
	// a uniformity proof; it's a smoke test that the hash is being used at
	// all (a bug that returned a constant would fail here).
	seen := map[uint32]bool{}
	for i := 0; i < 1024; i++ {
		id := "conv-" + string(rune('a'+i%26)) + "-" + strings.Repeat("z", i%17)
		seen[workerUIDFor(id)] = true
	}
	if len(seen) < 256 {
		t.Fatalf("expected wide UID spread, only %d distinct UIDs in 1024 samples", len(seen))
	}
}

func TestIsValidConversationID(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"abc", true},
		{"conv-1", true},
		{"conv_1", true},
		{"A1B2c3", true},
		{strings.Repeat("a", 128), true},

		{"", false},
		{strings.Repeat("a", 129), false},
		{"../etc", false},
		{"a/b", false},
		{"a b", false},
		{"a.b", false},
		{"a;b", false},
		{"a\nb", false},
	}
	for _, c := range cases {
		got := isValidConversationID(c.in)
		if got != c.want {
			t.Errorf("isValidConversationID(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
