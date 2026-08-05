package procsupervisor

import (
	"context"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

func TestRunOnceBoundedKillsOnDuration(t *testing.T) {
	s := New(true)
	start := time.Now()
	err := s.RunOnceBounded(context.Background(), "reap-test", ".", "sleep 30", nil, app.ReapLimits{
		MaxDuration: 300 * time.Millisecond,
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected the reaper to kill the process and return an error")
	}
	if elapsed > 5*time.Second {
		t.Fatalf("reaper took too long to kill: %s (should be ~2-2.5s: 300ms limit + up to 2s poll interval)", elapsed)
	}
}

func TestRunOnceBoundedLetsFastCommandsFinish(t *testing.T) {
	s := New(true)
	err := s.RunOnceBounded(context.Background(), "reap-test-ok", ".", "true", nil, app.ReapLimits{
		MaxDuration: 10 * time.Second,
		MaxRSSBytes: 1 << 30,
	})
	if err != nil {
		t.Fatalf("a fast, well-behaved command should not be reaped: %v", err)
	}
}
