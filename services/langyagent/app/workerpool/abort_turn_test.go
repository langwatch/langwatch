package workerpool

import (
	"context"
	"errors"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// abortRecordingAgent is a seedRecordingAgent that ALSO implements the optional
// app.TurnAborter capability, recording every abort so tests can prove which
// turn (if any) was told to die.
type abortRecordingAgent struct {
	seedRecordingAgent
	aborts   []string // turnIDs, in order
	sessions []string // sessionIDs, parallel to aborts
	abortErr error
}

func (a *abortRecordingAgent) AbortTurn(_ context.Context, _ app.Endpoint, sessionID, turnID string) error {
	a.aborts = append(a.aborts, turnID)
	a.sessions = append(a.sessions, sessionID)
	return a.abortErr
}

// compile-time proof the fake exercises the real capability interface.
var _ app.TurnAborter = (*abortRecordingAgent)(nil)

// claimedWorker registers a worker for conversationID whose agent is `agent`,
// with turnID claimed in flight, and returns it.
func claimedWorker(p *Pool, conversationID, turnID string, agent app.CodingAgent) *Worker {
	w := &Worker{
		conversationID:    conversationID,
		agent:             agent,
		endpoint:          app.Endpoint{BaseURL: "http://127.0.0.1:0", BearerToken: "b"},
		openCodeSessionID: "sess",
	}
	w.ClaimTurn(turnID)
	p.mu.Lock()
	p.workers[conversationID] = w
	p.mu.Unlock()
	return w
}

// The token-burn half of Stop (ADR-078): the cancel names a conversation and a
// turn, and the pool hands the abort to the worker actually running that turn
// — a registry lookup, never a spawn.
//
// @scenario "A cancel reaches the worker running the named turn"
// @scenario "A stop makes the manager abort the in-flight generation"
func TestPoolCancelTurn_ReachesTheClaimedTurnsWorker(t *testing.T) {
	p := newTestPool(4)
	agent := &abortRecordingAgent{}
	claimedWorker(p, "conv-1", "turn-1", agent)

	p.CancelTurn("conv-1", "turn-1")

	if len(agent.aborts) != 1 || agent.aborts[0] != "turn-1" {
		t.Fatalf("aborts = %v, want exactly the named turn", agent.aborts)
	}
	if agent.sessions[0] != "sess" {
		t.Errorf("abort session = %q, want the worker's own session", agent.sessions[0])
	}
}

// A stale or misaddressed cancel must never halt the wrong generation: a
// different turn in flight, a conversation with no worker, and an unnamed turn
// are all silent no-ops.
//
// @scenario "A cancel naming a turn that is not running changes nothing"
func TestPoolCancelTurn_StaleOrUnknownTurnIsANoOp(t *testing.T) {
	p := newTestPool(4)
	agent := &abortRecordingAgent{}
	claimedWorker(p, "conv-1", "turn-1", agent)

	// A different turn than the one in flight.
	p.CancelTurn("conv-1", "turn-2")
	// A conversation with no worker at all.
	p.CancelTurn("conv-unknown", "turn-1")
	// An empty turnID — a cancel needs a name.
	p.CancelTurn("conv-1", "")

	if len(agent.aborts) != 0 {
		t.Fatalf("aborts = %v, want none — only the in-flight turn may be aborted", agent.aborts)
	}
}

// A cancel for a worker that is idle (the turn already Released) finds nothing
// in flight and aborts nothing — the answer already landed.
func TestPoolCancelTurn_IdleWorkerIsANoOp(t *testing.T) {
	p := newTestPool(4)
	agent := &abortRecordingAgent{}
	w := claimedWorker(p, "conv-1", "turn-1", agent)
	w.Release()

	p.CancelTurn("conv-1", "turn-1")

	if len(agent.aborts) != 0 {
		t.Fatalf("aborts = %v, want none — the turn already finished", agent.aborts)
	}
}

// An agent WITHOUT the abort capability — opencode today — is fail-open: the
// cancel is a silent no-op and nothing about the running turn changes.
func TestWorkerAbortTurn_NonAbortingAgentIsANoOp(t *testing.T) {
	p := newTestPool(4)
	agent := &seedRecordingAgent{} // no AbortTurn method
	w := claimedWorker(p, "conv-1", "turn-1", agent)

	p.CancelTurn("conv-1", "turn-1")

	if !w.isInFlight() {
		t.Fatal("a no-op cancel must leave the claimed turn in flight")
	}
}

// A failing abort is best-effort: logged, never propagated — the durable
// stopped terminal upstream already made the stop truthful.
func TestWorkerAbortTurn_AbortFailureIsNonFatal(t *testing.T) {
	p := newTestPool(4)
	agent := &abortRecordingAgent{abortErr: errors.New("wire dropped")}
	claimedWorker(p, "conv-1", "turn-1", agent)

	p.CancelTurn("conv-1", "turn-1") // must not panic and has no error to return

	if len(agent.aborts) != 1 {
		t.Fatalf("aborts = %v, want the attempt to have been made", agent.aborts)
	}
}
