// The step-limit gate: the manager-side backstop that stops a turn stuck in a
// tool-call loop — the producer of the `langy_turn_step_limit` terminal error
// code the control plane's classifier renders.
//
// AGENTS.md rules 16 and 29 already tell the agent not to loop: rule 16 says a
// 401/403 is terminal and must not be retried with different flags, rule 29
// says an access it was told it lacks must not be attempted at all. This gate
// is for the turn where the model does it anyway — a permission-refused command
// re-run with variation after variation until the 120s wall-clock, filling the
// panel with a wall of identical failing cards. It counts SETTLED tool calls
// (the same frames the GitHub gate reads) and, past a generous ceiling, cancels
// the stream so driveTurn emits one vetted terminal frame instead.
package app

import (
	"encoding/json"
	"sync"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// codeTurnStepLimit is the vetted wire code this gate emits. It MUST match the
// case in the control plane's langyAgentErrorFromFrame (langy-turn-errors.ts) —
// the classifier that turns it into the typed terminal error the client renders.
const codeTurnStepLimit = "langy_turn_step_limit"

// maxToolCallsPerTurn bounds how many tool calls one turn may SETTLE before the
// gate stops it. A runaway backstop, NOT a normal-turn budget: a real turn —
// read a few things, run a command or two, retry once — is far under it, while a
// turn looping on a refused command settles hundreds of sub-second calls well
// inside the 120s wall-clock. The wall-clock is the primary bound; this stops
// the loop before it fills the transcript. Deliberately generous so a genuinely
// busy-but-progressing turn is never cut short.
const maxToolCallsPerTurn = 200

// stepGateToolFrame is the slice of the frames-union `tool` frame this gate
// reads: a settled tool call is `type:"tool"` with `phase:"end"`, one per tool
// invocation the worker completed.
type stepGateToolFrame struct {
	Type  string `json:"type"`
	Phase string `json:"phase"`
}

// stepLimitGate counts settled tool calls for one turn and trips once the count
// reaches its limit. It mirrors githubGate's shape exactly: Observe is called
// from the stream goroutine (inspect-only, never blocks or fails an emit),
// Tripped from driveTurn — hence the mutex — and a trip cancels the stream so
// driveTurn can emit the vetted terminal frame. Trips at most once. Bound to a
// single StreamSession call, so the counter never leaks across turns.
type stepLimitGate struct {
	limit  int
	cancel func()

	mu      sync.Mutex
	count   int
	tripped bool
}

func newStepLimitGate(limit int, cancel func()) *stepLimitGate {
	return &stepLimitGate{limit: limit, cancel: cancel}
}

// Observe counts one frame if it is a settled tool call, and trips when the
// count reaches the limit. Inspect-only from the sink's point of view.
func (g *stepLimitGate) Observe(f frames.Frame) {
	var tf stepGateToolFrame
	if err := json.Unmarshal([]byte(f.JSON()), &tf); err != nil {
		return
	}
	if tf.Type != "tool" || tf.Phase != "end" {
		return
	}

	g.mu.Lock()
	if g.tripped {
		g.mu.Unlock()
		return
	}
	g.count++
	trip := g.limit > 0 && g.count >= g.limit
	if trip {
		g.tripped = true
	}
	g.mu.Unlock()

	if trip && g.cancel != nil {
		g.cancel()
	}
}

// Tripped reports whether the turn exceeded its tool-call ceiling.
func (g *stepLimitGate) Tripped() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.tripped
}
