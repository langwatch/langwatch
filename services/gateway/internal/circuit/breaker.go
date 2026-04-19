// Package circuit implements a sliding-window circuit breaker keyed by
// provider credential ID. Matches the contract §9 / specs/ai-gateway
// commitment: "sliding window 30s / 10 failures → open for 60s".
//
// A breaker has three states:
//
//   - closed:  requests pass. Failures are counted in the sliding window.
//   - open:    all requests are short-circuited. After OpenFor elapses
//              we transition to half-open.
//   - half-open: a single probe request is allowed. On success → closed
//              (counter reset). On failure → open (counter carries over).
//
// This is a lock-striped concurrent map — one breaker per slot (usually
// a provider credential ID). The outer map is cheap to read; updates
// take the per-slot mutex. There's no background goroutine; state
// transitions happen lazily on the next request.
package circuit

import (
	"sync"
	"time"
)

type State int

const (
	StateClosed State = iota
	StateOpen
	StateHalfOpen
)

// Options tunes the breaker. Zero values use sensible defaults
// matching the contract.
type Options struct {
	Window         time.Duration // window over which failures are counted (default 30s)
	FailureLimit   int           // failures in window before opening (default 10)
	OpenFor        time.Duration // how long to stay open before probing (default 60s)
	Clock          func() time.Time
}

// Registry owns a per-slot map of breakers. Safe for concurrent use.
// Slots are usually provider-credential IDs.
type Registry struct {
	opts Options
	mu   sync.RWMutex
	per  map[string]*slot
}

// NewRegistry returns a breaker registry with the given options.
func NewRegistry(opts Options) *Registry {
	if opts.Window == 0 {
		opts.Window = 30 * time.Second
	}
	if opts.FailureLimit == 0 {
		opts.FailureLimit = 10
	}
	if opts.OpenFor == 0 {
		opts.OpenFor = 60 * time.Second
	}
	if opts.Clock == nil {
		opts.Clock = time.Now
	}
	return &Registry{opts: opts, per: make(map[string]*slot)}
}

// Allow reports whether a request against the given slot may proceed.
// It also advances the breaker's state machine based on time (open →
// half-open transition).
func (r *Registry) Allow(slotID string) bool {
	s := r.slotFor(slotID)
	s.mu.Lock()
	defer s.mu.Unlock()
	now := r.opts.Clock()
	switch s.state {
	case StateOpen:
		if now.After(s.openedAt.Add(r.opts.OpenFor)) {
			// Transition straight to half-open AND claim the probe
			// slot for this caller so a concurrent Allow() that
			// arrives microseconds later still observes inFlight=1
			// and is rejected.
			s.state = StateHalfOpen
			s.inFlight = 1
			return true
		}
		return false
	case StateHalfOpen:
		if s.inFlight > 0 {
			return false
		}
		s.inFlight = 1
		return true
	default:
		return true
	}
}

// RecordSuccess tells the breaker the slot's last attempt succeeded.
// From half-open → closed. From closed → closed (cleared window).
func (r *Registry) RecordSuccess(slotID string) {
	s := r.slotFor(slotID)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = StateClosed
	s.failures = s.failures[:0]
	s.inFlight = 0
}

// RecordFailure tells the breaker the slot's last attempt failed. If
// failures in the sliding window reach the limit, the breaker opens.
// From half-open the breaker opens immediately regardless of window.
func (r *Registry) RecordFailure(slotID string) {
	s := r.slotFor(slotID)
	s.mu.Lock()
	defer s.mu.Unlock()
	now := r.opts.Clock()
	cutoff := now.Add(-r.opts.Window)
	pruned := s.failures[:0]
	for _, t := range s.failures {
		if t.After(cutoff) {
			pruned = append(pruned, t)
		}
	}
	pruned = append(pruned, now)
	s.failures = pruned
	s.inFlight = 0
	if s.state == StateHalfOpen {
		s.state = StateOpen
		s.openedAt = now
		return
	}
	if len(pruned) >= r.opts.FailureLimit {
		s.state = StateOpen
		s.openedAt = now
	}
}

// State returns the current state of the given slot (for observability).
func (r *Registry) State(slotID string) State {
	s := r.slotFor(slotID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == StateOpen && r.opts.Clock().After(s.openedAt.Add(r.opts.OpenFor)) {
		return StateHalfOpen
	}
	return s.state
}

func (r *Registry) slotFor(id string) *slot {
	r.mu.RLock()
	s, ok := r.per[id]
	r.mu.RUnlock()
	if ok {
		return s
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok = r.per[id]; ok {
		return s
	}
	s = &slot{}
	r.per[id] = s
	return s
}

type slot struct {
	mu       sync.Mutex
	state    State
	failures []time.Time
	openedAt time.Time
	inFlight int
}
