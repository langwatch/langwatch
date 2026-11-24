package engine

import (
	"testing"
	"time"
)

func TestElapsedMSRoundsSubMillisecondWorkUp(t *testing.T) {
	if got := elapsedMS(time.Now().Add(-400 * time.Microsecond)); got != 1 {
		t.Fatalf("a 0.4 ms node reads %d ms, want 1", got)
	}
}

func TestElapsedMSRoundsUpToTheNextWholeMillisecond(t *testing.T) {
	got := elapsedMS(time.Now().Add(-57*time.Millisecond - 300*time.Microsecond))
	if got != 58 {
		t.Fatalf("a 57.3 ms node reads %d ms, want 58", got)
	}
}
