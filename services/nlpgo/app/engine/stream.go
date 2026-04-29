package engine

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/planner"
)

// StreamEvent is one frame on the engine's output channel. Mirrors the
// Python `StudioServerEvent` discriminated union so the SSE serializer
// can emit it verbatim.
type StreamEvent struct {
	Type    string         `json:"type"` // is_alive_response | execution_state_change | done | error
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
// Heartbeat ticks emit `is_alive_response` events; the SSE handler relies on
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
		// Write back so downstream dispatch (runEvaluator,
		// runAgentWorkflow) sees the same trace id when calling out
		// to LangWatch endpoints. Mirrors the Execute() path.
		req.TraceID = traceID
	}
	plan, err := planner.New(req.Workflow)
	if err != nil {
		return nil, err
	}
	state := newRunState(req.Workflow)
	applyManualInputs(state, req)
	// execute_component (req.NodeID set) must dispatch ONLY the
	// requested node. Validate target exists before starting the
	// goroutine so callers get a synchronous error instead of an
	// async error event. See Engine.Execute for the same guard.
	if req.NodeID != "" {
		if _, ok := state.nodes[req.NodeID]; !ok {
			return nil, errInvalidRequest{msg: fmt.Sprintf("engine: execute_component target node %q not in workflow", req.NodeID)}
		}
	}

	out := make(chan StreamEvent, 16)
	go func() {
		started := time.Now()

		// Heartbeat goroutine — emits is_alive_response every Heartbeat ticks
		// until the run completes. We must wait for it to fully exit
		// before closing `out`; otherwise an in-flight emit() can race
		// with close() and panic with "send on closed channel".
		hbCtx, hbCancel := context.WithCancel(ctx)
		var hbDone chan struct{}
		if opts.Heartbeat > 0 {
			hbDone = make(chan struct{})
			go func() {
				defer close(hbDone)
				heartbeat(hbCtx, traceID, opts.Heartbeat, out)
			}()
		}
		defer func() {
			hbCancel()
			if hbDone != nil {
				<-hbDone
			}
			close(out)
		}()

		// execute_component (req.NodeID set) — dispatch only the
		// requested node, never the full DAG. Same parity rationale as
		// Engine.Execute: Studio's per-component Run flow on a single
		// card should not surface entry/end/sibling spans in the trace.
		if req.NodeID != "" {
			e.runLayerStream(ctx, req, plan, state, []string{req.NodeID}, traceID, out)
			emit(ctx, out, doneEvent(traceID, state, started))
			return
		}
		for _, layer := range plan.Layers {
			if err := ctx.Err(); err != nil {
				emit(ctx, out, StreamEvent{
					Type:    "error",
					TraceID: traceID,
					Payload: map[string]any{"message": err.Error()},
				})
				return
			}
			e.runLayerStream(ctx, req, plan, state, layer, traceID, out)
			if state.firstError != nil {
				emit(ctx, out, doneEvent(traceID, state, started))
				return
			}
		}
		emit(ctx, out, doneEvent(traceID, state, started))
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
			emit(ctx, out, stateEvent(traceID, nodeID, ns))
			nodeCtx, span := startNodeSpan(ctx, node, req)
			started := time.Now()
			outputs, derr := e.dispatch(nodeCtx, req, node, inputs, ns)
			ns.DurationMS = time.Since(started).Milliseconds()
			endNodeSpan(span, ns, derr)
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
			emit(ctx, out, stateEvent(traceID, nodeID, ns))
		}()
	}
	wg.Wait()
}

// heartbeat emits is_alive_response frames at the given interval until
// ctx is done. Skipped silently when the run completes faster than one
// tick. The type matches Python's StudioServerEvent union.
func heartbeat(ctx context.Context, traceID string, every time.Duration, out chan<- StreamEvent) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			emit(ctx, out, StreamEvent{Type: "is_alive_response", TraceID: traceID})
		}
	}
}

// emit is a non-blocking send for heartbeats (drop if consumer is
// slow) and a blocking-but-cancelable send for everything else (state
// changes are load-bearing — never drop, but never block forever
// either: if ctx is canceled and the consumer has stopped draining,
// the goroutine returns instead of leaking on the chan send).
func emit(ctx context.Context, out chan<- StreamEvent, ev StreamEvent) {
	if ev.Type == "is_alive_response" {
		select {
		case out <- ev:
		default:
		}
		return
	}
	select {
	case out <- ev:
	case <-ctx.Done():
	}
}

// stateEvent wraps a per-node update in the Python-aligned
// `component_state_change` envelope that the Studio TS parser expects:
//
//	{type: "component_state_change",
//	 payload: {component_id: <id>, execution_state: <ExecutionState>}}
//
// We project NodeState onto Python's ExecutionState shape so all
// downstream consumers (Studio reducer, Sentry capture, etc.) see one
// schema regardless of which engine produced the event.
func stateEvent(traceID, nodeID string, ns *NodeState) StreamEvent {
	es := map[string]any{"status": ns.Status}
	if ns.Inputs != nil {
		es["inputs"] = ns.Inputs
	}
	if ns.Outputs != nil {
		es["outputs"] = ns.Outputs
	}
	if ns.Cost > 0 {
		es["cost"] = ns.Cost
	}
	if ns.Error != nil {
		es["error"] = ns.Error.Message
	}
	if ns.DurationMS > 0 {
		// Studio's ExecutionOutputPanel renders the per-component
		// duration via `<SpanDuration>` only when BOTH
		// `timestamps.started_at` and `timestamps.finished_at` are set
		// (`hasTiming = started_at && finished_at`). Derive started_at
		// from finished_at − DurationMS rather than threading absolute
		// clock-times through NodeState — the UI only uses the diff,
		// and the wall-clock skew between the running and finished
		// events is measured in microseconds.
		finishedAt := time.Now().UnixMilli()
		es["timestamps"] = map[string]any{
			"started_at":  finishedAt - ns.DurationMS,
			"finished_at": finishedAt,
		}
	}
	return StreamEvent{
		Type:    "component_state_change",
		TraceID: traceID,
		Payload: map[string]any{
			"component_id":    nodeID,
			"execution_state": es,
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
