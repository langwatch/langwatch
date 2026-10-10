package diffkit

import (
	"errors"
	"strings"
	"testing"
)

func TestStreakStopsAtLimitWithMostCommonCause(t *testing.T) {
	streak := NewStreak(4)
	for _, cause := range []string{"timeout", "refused", "timeout"} {
		if streak.Error(cause) {
			t.Fatal("tripped before the limit")
		}
	}
	if !streak.Error("timeout") {
		t.Fatal("did not trip at the limit")
	}
	want := "stopping: 4 consecutive errors, most common cause: timeout (x3)"
	if got := streak.Stopped().Reason; got != want {
		t.Fatalf("reason %q, want %q", got, want)
	}
	if streak.Error("timeout") {
		t.Fatal("tripped twice")
	}
}

func TestStreakOKResetsAndFailIsNeutral(t *testing.T) {
	streak := NewStreak(3)
	streak.Error("a")
	streak.Error("a")
	// A FAIL calls neither method: the two errors stand.
	if !streak.Error("a") {
		t.Fatal("a FAIL between errors must not reset the streak")
	}
	streak = NewStreak(3)
	streak.Error("a")
	streak.Error("a")
	streak.OK()
	if streak.Error("a") || streak.Stopped() != nil {
		t.Fatal("a result that worked must reset the streak")
	}
}

func TestStreakZeroDisables(t *testing.T) {
	streak := NewStreak(0)
	for range 1000 {
		if streak.Error("a") {
			t.Fatal("a limit of 0 must never trip")
		}
	}
}

func TestSetupFailedNamesTheCause(t *testing.T) {
	err := SetupFailed(errors.New("seed organization: status 404"))
	if !strings.HasPrefix(err.Error(), "stopping: setup failed: seed organization") {
		t.Fatal(err)
	}
}
