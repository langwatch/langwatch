package engine

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestExecuteStream_HeartbeatExitDoesNotRaceWithClose pins the fix for
// the heartbeat-vs-close panic. The original code had:
//
//	defer close(out)
//	defer hbCancel()  // ← runs first; signals heartbeat to stop
//	go heartbeat(...) // ← may still be inside emit(out, ev) when close
//	                  // runs, panicking with "send on closed channel".
//
// Fix: wait for the heartbeat goroutine to drain (hbDone) before
// closing out. Without the fix, this loop reliably panics under -race.
func TestExecuteStream_HeartbeatExitDoesNotRaceWithClose(t *testing.T) {
	eng := New(Options{})

	wf := &dsl.Workflow{
		WorkflowID: "race_repro",
		Nodes: []dsl.Node{
			{
				ID:   "entry",
				Type: dsl.ComponentEntry,
				Data: dsl.Component{},
			},
		},
	}

	// Tight loop: many iterations × 1ms heartbeat × very-fast workflow
	// completion maximises the chance of an emit() landing in the
	// closed-channel window. 200 iterations is enough that a real race
	// shows up in CI under -race even at low scheduler pressure.
	const iterations = 200
	for i := 0; i < iterations; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		ch, err := eng.ExecuteStream(ctx, ExecuteRequest{Workflow: wf}, ExecuteStreamOptions{
			Heartbeat: time.Millisecond,
		})
		if err != nil {
			cancel()
			t.Fatalf("ExecuteStream: %v", err)
		}
		// Drain a few frames, then cancel + drain to completion.
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range ch {
			}
		}()
		cancel()
		wg.Wait()
	}
}
