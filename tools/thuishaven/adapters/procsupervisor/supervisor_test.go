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

func TestSuperviseKillsALaneOverItsMemoryCeilingAndRestartsIt(t *testing.T) {
	s := New(true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reaps := make(chan string, 4)
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.superviseChild(ctx, app.Child{
			Name: "capped", Dir: t.TempDir(), Shell: "sleep 30", MaxRSSBytes: 1,
			OnReap: func(reason string) { reaps <- reason },
		})
	}()
	for range 2 { // killed, restarted, killed again
		select {
		case <-reaps:
		case <-time.After(10 * time.Second):
			t.Fatal("the lane over its ceiling was not killed and restarted")
		}
	}
	cancel()
	<-done
}
