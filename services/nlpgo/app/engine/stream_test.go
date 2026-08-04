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
			// End node required by the missing-End planner guard (#3198).
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", Target: "end"},
		},
	}

	// Tight loop: many iterations × 1ms heartbeat × very-fast workflow
	// completion maximizes the chance of an emit() landing in the
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

// TestStateEvent_TimestampsHaveBothStartedAndFinished pins both
// timestamps on the per-component finished event so Studio's
// ExecutionOutputPanel can render the duration line.
//
// ExecutionOutputPanel.tsx gates "<duration>ms · Full Trace" on:
//
//	const hasTiming = executionState.timestamps?.started_at &&
//	                  executionState.timestamps?.finished_at;
//
// Both must be present or the line goes silent.
func TestStateEvent_TimestampsHaveBothStartedAndFinished(t *testing.T) {
	ns := &NodeState{
		ID:         "code",
		Status:     "success",
		DurationMS: 250,
	}
	ev := stateEvent("trace-x", "code", ns)
	payload, ok := ev.Payload["execution_state"].(map[string]any)
	if !ok {
		t.Fatalf("execution_state missing or wrong type")
	}
	ts, ok := payload["timestamps"].(map[string]any)
	if !ok {
		t.Fatalf("timestamps map missing — UI uses it to gate the duration line")
	}
	startedRaw, hasStarted := ts["started_at"]
	finishedRaw, hasFinished := ts["finished_at"]
	if !hasStarted || !hasFinished {
		t.Fatalf("expected both started_at and finished_at; got %v", ts)
	}
	started, ok := startedRaw.(int64)
	if !ok {
		t.Fatalf("started_at must be int64; got %T", startedRaw)
	}
	finished, ok := finishedRaw.(int64)
	if !ok {
		t.Fatalf("finished_at must be int64; got %T", finishedRaw)
	}
	if got := finished - started; got != ns.DurationMS {
		t.Errorf("finished - started = %dms; want %dms (DurationMS round-trip)", got, ns.DurationMS)
	}
}

// TestStateEvent_NoTimestampsBeforeCompletion pins the inverse: a node
// that has not finished (running) or that never ran (skipped) must NOT
// emit a timestamps map, otherwise the UI's hasTiming gate would render a
// duration for an event that has no finished_at yet.
func TestStateEvent_NoTimestampsBeforeCompletion(t *testing.T) {
	for _, status := range []string{"running", string(dsl.StatusSkipped)} {
		ns := &NodeState{ID: "code", Status: status, DurationMS: 0}
		ev := stateEvent("trace-x", "code", ns)
		payload := ev.Payload["execution_state"].(map[string]any)
		if _, ok := payload["timestamps"]; ok {
			t.Errorf("%s event must not include timestamps; got %v", status, payload["timestamps"])
		}
	}
}

// TestStateEvent_TimestampsEmittedForZeroDurationCompletion pins the fix
// for a sub-millisecond node (if/else) re-run never refreshing the panel:
// a completed node must emit timestamps even when DurationMS rounds to 0,
// so the Studio reducer overwrites a stale duration from a prior, slower
// run instead of merging nothing over it.
func TestStateEvent_TimestampsEmittedForZeroDurationCompletion(t *testing.T) {
	ns := &NodeState{ID: "if_else", Status: string(dsl.StatusSuccess), DurationMS: 0}
	ev := stateEvent("trace-x", "if_else", ns)
	payload := ev.Payload["execution_state"].(map[string]any)
	ts, ok := payload["timestamps"].(map[string]any)
	if !ok {
		t.Fatalf("a completed 0ms node must still emit timestamps so a re-run refreshes the panel")
	}
	started, finished := ts["started_at"].(int64), ts["finished_at"].(int64)
	if finished-started != 0 {
		t.Errorf("finished - started = %dms; want 0ms for a sub-millisecond node", finished-started)
	}
}
