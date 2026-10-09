package app

import (
	"sync"
	"time"
)

// stoppedTurnTTL is how long a stopped turn id is remembered. It covers the
// window a dispatch can still arrive in: the control plane's handoff lives 5
// minutes and its outbox re-drives within that, so nothing can reach us naming
// a turn older than this.
const stoppedTurnTTL = 5 * time.Minute

// stoppedTurns remembers the turns the control plane has canceled.
//
// A cancel can only abort a worker that is already running the turn, and the
// gap between a dispatch arriving and its worker being ready is the whole cold
// start — seconds, and exactly when a user stops an answer they did not mean to
// ask for. Without this the cancel finds no worker, halts nothing, and the turn
// the user stopped is generated in full.
//
// Bounded by the TTL above, pruned on every write, and keyed by turn id alone:
// ids are unique across conversations, and the set is at most one entry per
// stopped turn in a five-minute window.
type stoppedTurns struct {
	mu  sync.Mutex
	at  map[string]time.Time
	ttl time.Duration
	now func() time.Time
}

func newStoppedTurns() *stoppedTurns {
	return &stoppedTurns{
		at:  map[string]time.Time{},
		ttl: stoppedTurnTTL,
		now: time.Now,
	}
}

// record marks a turn as stopped. An empty id is ignored: a cancel needs a name.
func (s *stoppedTurns) record(turnID string) {
	if turnID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for id, at := range s.at {
		if now.Sub(at) > s.ttl {
			delete(s.at, id)
		}
	}
	s.at[turnID] = now
}

// has reports whether this turn was stopped and the record has not aged out.
func (s *stoppedTurns) has(turnID string) bool {
	if turnID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	at, ok := s.at[turnID]
	if !ok {
		return false
	}
	if s.now().Sub(at) > s.ttl {
		delete(s.at, turnID)
		return false
	}
	return true
}
