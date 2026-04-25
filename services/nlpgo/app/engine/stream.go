package engine

import (
	"context"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/planner"
)

// StreamEvent is one frame on the engine's output channel. Mirrors the
// Python `StudioServerEvent` discriminated union so the SSE serializer
// can emit it verbatim.
type StreamEvent struct {
	Type    string         `json:"type"` // is_alive | execution_state_change | done | error
	TraceID string         `json:"trace_id,omitempty"`
	Payload map[string]any `json:"payload,omitempty"`
}

// ExecuteStreamOptions carries per-stream knobs that don't belong on the
// engine itself (heartbeat cadence, idle timeout) so handlers can tune
// per-route.
type ExecuteStreamOptions struct {
	Heartbeat time.Duration
}

// ExecuteStream runs the workflow and pushes events on the returned
// channel as nodes complete. The channel is closed when the run ends
// (success, error, or context cancellation).
//
// Heartbeat ticks emit `is_alive` events; the SSE handler relies on
// these to keep the connection alive past intermediate proxy timeouts.
// Idle-timeout detection lives in the handler (not here) because only
// the handler observes whether the client received the chunk.
func (e *Engine) ExecuteStream(ctx context.Context, req ExecuteRequest, opts ExecuteStreamOptions) (<-chan StreamEvent, error) {
	if req.Workflow == nil {
		return nil, errInvalidRequest{msg: "engine: nil workflow"}
	}
	traceID := req.TraceID
	if traceID == "" {
		traceID = ulid.Make().String()
	}
	plan, err := planner.New(req.Workflow)
	if err != nil {
		return nil, err
	}
	state := newRunState(req.Workflow)

	out := make(chan StreamEvent, 16)
	go func() {
		defer close(out)
		started := time.Now()

		// Heartbeat goroutine — emits is_alive every Heartbeat ticks
		// until the run completes.
		hbCtx, hbCancel := context.WithCancel(ctx)
		defer hbCancel()
		if opts.Heartbeat > 0 {
			go heartbeat(hbCtx, traceID, opts.Heartbeat, out)
		}

		for _, layer := range plan.Layers {
			if err := ctx.Err(); err != nil {
				emit(out, StreamEvent{
					Type:    "error",
					TraceID: traceID,
					Payload: map[string]any{"message": err.Error()},
				})
				return
			}
			e.runLayerStream(ctx, req, plan, state, layer, traceID, out)
			if state.firstError != nil {
				emit(out, doneEvent(traceID, state, started))
				return
			}
		}
		emit(out, doneEvent(traceID, state, started))
	}()
	return out, nil
}

// runLayerStream is runLayer + per-node event emission.
func (e *Engine) runLayerStream(ctx context.Context, req ExecuteRequest, plan *planner.Plan, state *runState, layer []string, traceID string, out chan<- StreamEvent) {
	var wg sync.WaitGroup
	for _, id := range layer {
		nodeID := id
		wg.Add(1)
		go func() {
			defer wg.Done()
			node := state.nodes[nodeID]
			inputs := state.resolveInputs(plan, nodeID)
			ns := &NodeState{ID: nodeID, Status: "running", Inputs: inputs}
			emit(out, stateEvent(traceID, nodeID, ns))
			started := time.Now()
			outputs, derr := e.dispatch(ctx, req, node, inputs, ns)
			ns.DurationMS = time.Since(started).Milliseconds()
			if derr != nil {
				ns.Status = "error"
				ns.Error = derr
				ns.Error.NodeID = nodeID
				state.recordError(derr)
			} else {
				ns.Status = "success"
				ns.Outputs = outputs
				state.recordOutputs(nodeID, outputs)
			}
			state.recordState(nodeID, ns)
			emit(out, stateEvent(traceID, nodeID, ns))
		}()
	}
	wg.Wait()
}

// heartbeat emits is_alive frames at the given interval until ctx is
// done. Skipped silently when the run completes faster than one tick.
func heartbeat(ctx context.Context, traceID string, every time.Duration, out chan<- StreamEvent) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			emit(out, StreamEvent{Type: "is_alive", TraceID: traceID})
		}
	}
}

// emit is a non-blocking send for heartbeats (drop if consumer is
// slow) and a blocking send for everything else (state changes are
// load-bearing — never drop).
func emit(out chan<- StreamEvent, ev StreamEvent) {
	if ev.Type == "is_alive" {
		select {
		case out <- ev:
		default:
		}
		return
	}
	out <- ev
}

func stateEvent(traceID, nodeID string, ns *NodeState) StreamEvent {
	return StreamEvent{
		Type:    "execution_state_change",
		TraceID: traceID,
		Payload: map[string]any{
			"node_id": nodeID,
			"state":   ns,
		},
	}
}

func doneEvent(traceID string, state *runState, started time.Time) StreamEvent {
	res := finalize(state, traceID, started, nil)
	if res.Status == "error" {
		return StreamEvent{
			Type:    "done",
			TraceID: traceID,
			Payload: map[string]any{
				"status": "error",
				"result": map[string]any{},
				"error":  res.Error,
			},
		}
	}
	return StreamEvent{
		Type:    "done",
		TraceID: traceID,
		Payload: map[string]any{
			"status":      "success",
			"result":      res.Result,
			"nodes":       res.Nodes,
			"total_cost":  res.TotalCost,
			"duration_ms": res.DurationMS,
		},
	}
}

// errInvalidRequest is a small sentinel for shape errors.
type errInvalidRequest struct{ msg string }

func (e errInvalidRequest) Error() string { return e.msg }
