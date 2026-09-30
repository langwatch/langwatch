package voicesim

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// maxCalls is how many recent calls the console keeps; the oldest drops first.
const maxCalls = 200

// maxEventsPerCall bounds one call's event log; later events are counted, not kept.
const maxEventsPerCall = 500

// Call is one simulated conversation, as the console shows it.
type Call struct {
	ID            string     `json:"id"`
	AgentID       string     `json:"agentId"`
	StartedAt     time.Time  `json:"startedAt"`
	EndedAt       *time.Time `json:"endedAt,omitempty"`
	CallerFrames  int        `json:"callerFrames"`
	AgentFrames   int        `json:"agentFrames"`
	Turns         []Turn     `json:"turns"`
	Events        []Event    `json:"events"`
	DroppedEvents int        `json:"droppedEvents"`
}

// Turn is one caller utterance and the scripted reply to it.
type Turn struct {
	Index        int       `json:"index"`
	At           time.Time `json:"at"`
	CallerText   string    `json:"callerText"`
	AgentText    string    `json:"agentText"`
	CallerFrames int       `json:"callerFrames"`
	AgentFrames  int       `json:"agentFrames"`
}

// Event is one protocol message in or out, audio frames excepted (those are counted).
type Event struct {
	At        time.Time `json:"at"`
	Direction string    `json:"direction"` // "in" from the product, "out" from voicesim
	Type      string    `json:"type"`
}

// callLog is the bounded ring of recent calls the console reads.
type callLog struct {
	mu    sync.Mutex
	next  int
	calls []*Call // oldest first
}

// open starts a call with a deterministic id: conv_voicesim_0001, 0002, ...
func (l *callLog) open(agentID string) *Call {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.next++
	call := &Call{ID: fmt.Sprintf("conv_voicesim_%04d", l.next), AgentID: agentID, StartedAt: time.Now().UTC()}
	if len(l.calls) == maxCalls {
		l.calls = l.calls[1:]
	}
	l.calls = append(l.calls, call)
	return call
}

// update changes a call under the log's lock, so the console never reads it half-written.
func (l *callLog) update(call *Call, change func(*Call)) {
	l.mu.Lock()
	defer l.mu.Unlock()
	change(call)
}

// event records one protocol message on the call.
func (l *callLog) event(call *Call, direction, kind string) {
	l.update(call, func(c *Call) {
		if len(c.Events) >= maxEventsPerCall {
			c.DroppedEvents++
			return
		}
		c.Events = append(c.Events, Event{At: time.Now().UTC(), Direction: direction, Type: kind})
	})
}

// len is how many calls the log holds.
func (l *callLog) len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.calls)
}

// marshal renders the calls newest first, under the lock.
func (l *callLog) marshal() ([]byte, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	newest := make([]*Call, 0, len(l.calls))
	for i := len(l.calls) - 1; i >= 0; i-- {
		newest = append(newest, l.calls[i])
	}
	return json.Marshal(map[string]any{"calls": newest})
}
