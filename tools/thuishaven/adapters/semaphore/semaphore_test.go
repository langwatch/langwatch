package semaphore

import (
	"context"
	"os"
	"path/filepath"
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

func TestTryAcquireReturnsSlotFileError(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, "locks", "tc")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "slot-0"), 0o755); err != nil {
		t.Fatal(err)
	}

	_, _, ok, err := New(home).TryAcquire("tc", 1)
	if err == nil {
		t.Fatal("TryAcquire should return an error when a slot path cannot be opened")
	}
	if ok {
		t.Fatal("TryAcquire should not report a slot as acquired after an open error")
	}
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
