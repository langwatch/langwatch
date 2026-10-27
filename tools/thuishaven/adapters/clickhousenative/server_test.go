package clickhousenative

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "A second worktree starting ClickHouse waits for the first"
func TestLockMakesASecondHavenWait(t *testing.T) {
	home := t.TempDir()
	first, second := New(home, domain.PinnedArtifact{}, domain.ClickHouseLimits{}), New(home, domain.PinnedArtifact{}, domain.ClickHouseLimits{})
	unlock, err := first.lock(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	acquired := make(chan error, 1)
	go func() {
		release, err := second.lock(context.Background())
		if err == nil {
			release()
		}
		acquired <- err
	}()
	select {
	case <-acquired:
		t.Fatal("second lock taken while the first is held")
	case <-time.After(400 * time.Millisecond):
	}
	unlock()
	select {
	case err := <-acquired:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("second lock never taken after the first was released")
	}
}

// @scenario "A haven waiting on the lock gives up when its context ends"
func TestLockGivesUpWithItsContext(t *testing.T) {
	home := t.TempDir()
	unlock, err := New(home, domain.PinnedArtifact{}, domain.ClickHouseLimits{}).lock(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	if _, err := New(home, domain.PinnedArtifact{}, domain.ClickHouseLimits{}).lock(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want deadline exceeded, got %v", err)
	}
}
