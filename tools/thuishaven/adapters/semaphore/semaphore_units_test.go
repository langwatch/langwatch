package semaphore

import (
	"os"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "A run takes all of its units or none"
func TestTryAcquireUnitsTakesAllOrNone(t *testing.T) {
	s := New(t.TempDir())
	hold, ok, err := s.TryAcquireUnits("checks", 4, domain.SlotClaim{Units: 3, PID: 11, Class: "typecheck", StartedAt: time.Now()})
	if err != nil || !ok {
		t.Fatalf("first take: ok=%v err=%v", ok, err)
	}
	if _, ok, err := s.TryAcquireUnits("checks", 4, domain.SlotClaim{Units: 2, PID: 12, Class: "test"}); err != nil || ok {
		t.Fatalf("2 units with 1 free must fail: ok=%v err=%v", ok, err)
	}
	// The failed take gave its one unit back: a 1-unit run still fits.
	one, ok, err := s.TryAcquireUnits("checks", 4, domain.SlotClaim{Units: 1, PID: 13, Class: "lint"})
	if err != nil || !ok {
		t.Fatalf("the free unit must still be free after a failed take: ok=%v err=%v", ok, err)
	}
	one()
	hold()
	both, ok, err := s.TryAcquireUnits("checks", 4, domain.SlotClaim{Units: 2, PID: 12, Class: "test"})
	if err != nil || !ok {
		t.Fatalf("after release 2 units must fit: ok=%v err=%v", ok, err)
	}
	both()
}

func TestTryAcquireUnitsCapsAWeightAboveTheBudget(t *testing.T) {
	s := New(t.TempDir())
	release, ok, err := s.TryAcquireUnits("checks", 2, domain.SlotClaim{Units: 4, PID: 11})
	if err != nil || !ok {
		t.Fatalf("a weight over the budget takes the whole budget: ok=%v err=%v", ok, err)
	}
	defer release()
	if got := s.Holders("checks"); len(got) != 1 || got[0].Units != 2 {
		t.Fatalf("holders = %+v, want one holder of 2 units", got)
	}
}

// @scenario "slot explain names who holds the units"
func TestHoldersNamesUnitHoldersAndUnnamedSlots(t *testing.T) {
	s := New(t.TempDir())
	if got := s.Holders("checks"); len(got) != 0 {
		t.Fatalf("no lock dir must read as no holders, got %+v", got)
	}
	legacy, _, ok, err := s.TryAcquire("checks", 1)
	if err != nil || !ok {
		t.Fatalf("legacy take: ok=%v err=%v", ok, err)
	}
	units, ok, err := s.TryAcquireUnits("checks", 4, domain.SlotClaim{Units: 2, PID: os.Getpid(), Class: "test", Worktree: "/w/a", StartedAt: time.Now()})
	if err != nil || !ok {
		t.Fatalf("unit take: ok=%v err=%v", ok, err)
	}
	got := s.Holders("checks")
	if len(got) != 2 || got[0].PID != 0 || got[0].Units != 1 || got[1].Class != "test" || got[1].Units != 2 || got[1].Worktree != "/w/a" {
		t.Fatalf("holders = %+v, want one unnamed unit then the test run's 2", got)
	}
	units()
	legacy()
	if got := s.Holders("checks"); len(got) != 0 {
		t.Fatalf("released files must read as free, got %+v", got)
	}
}
