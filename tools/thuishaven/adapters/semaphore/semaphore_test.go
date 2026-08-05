package semaphore

import (
	"context"
	"testing"
	"time"
)

func TestAcquireBlocksWhenAllSlotsHeld(t *testing.T) {
	s := New(t.TempDir())

	release1, slot1, err := s.Acquire(context.Background(), "tc", 1)
	if err != nil || slot1 != 1 {
		t.Fatalf("first acquire: slot=%d err=%v, want slot 1", slot1, err)
	}

	// With the only slot held, a second acquire must block until ctx expires.
	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	if _, _, err := s.Acquire(ctx, "tc", 1); err == nil {
		t.Fatalf("second acquire should have blocked until ctx deadline, but got a slot")
	}

	// Release the slot; a fresh acquire now succeeds immediately.
	release1()
	release2, slot2, err := s.Acquire(context.Background(), "tc", 1)
	if err != nil || slot2 != 1 {
		t.Fatalf("acquire after release: slot=%d err=%v, want slot 1", slot2, err)
	}
	release2()
}

func TestTwoSlotsAllowTwoConcurrent(t *testing.T) {
	s := New(t.TempDir())
	r1, s1, err := s.Acquire(context.Background(), "tc", 2)
	if err != nil {
		t.Fatal(err)
	}
	r2, s2, err := s.Acquire(context.Background(), "tc", 2)
	if err != nil {
		t.Fatal(err)
	}
	if s1 == s2 {
		t.Fatalf("two concurrent acquires took the same slot %d", s1)
	}
	r1()
	r2()
}
