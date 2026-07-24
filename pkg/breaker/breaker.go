// Package breaker implements a sliding-window circuit breaker keyed by slot ID.
//
// Three states: closed → open → half-open → closed.
// State transitions happen lazily on the next request (no background goroutine).
package breaker

import (
	"sync"
	"time"
)

// State represents the breaker's current mode.
type State int

const (
	Closed   State = iota // requests pass; failures counted
	Open                  // requests short-circuited
	HalfOpen              // single probe allowed
)

// Options tunes the breaker. Zero values use sensible defaults.
type Options struct {
	Window       time.Duration    // failure counting window (default 30s)
	Threshold    int              // failures before opening (default 10)
	OpenDuration time.Duration    // time in open state before probing (default 60s)
	Clock        func() time.Time // injectable clock for testing
}

func (o *Options) withDefaults() {
	if o.Window == 0 {
		o.Window = 30 * time.Second
	}
	if o.Threshold == 0 {
		o.Threshold = 10
	}
	if o.OpenDuration == 0 {
		o.OpenDuration = 60 * time.Second
	}
	if o.Clock == nil {
		o.Clock = time.Now
	}
}

// Registry owns a concurrent map of breakers keyed by slot ID.
type Registry struct {
	opts    Options
	mu      sync.RWMutex
	entries map[string]*slot
}

// NewRegistry creates a breaker registry.
func NewRegistry(opts Options) *Registry {
	opts.withDefaults()
	return &Registry{opts: opts, entries: make(map[string]*slot)}
}

// Allow reports whether a request to the given slot may proceed.
func (r *Registry) Allow(id string) bool {
	s := r.getSlot(id)
	s.mu.Lock()
	defer s.mu.Unlock()

	now := r.opts.Clock()
	switch s.state {
	case Open:
		if now.After(s.openedAt.Add(r.opts.OpenDuration)) {
			s.state = HalfOpen
			s.inFlight = 1
			return true
		}
		return false
	case HalfOpen:
		if s.inFlight > 0 {
			return false
		}
		s.inFlight = 1
		return true
	default:
		return true
	}
}

// RecordSuccess marks a successful attempt. Resets the breaker to closed.
func (r *Registry) RecordSuccess(id string) {
	s := r.getSlot(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = Closed
	s.failures = s.failures[:0]
	s.inFlight = 0
}

// RecordFailure marks a failed attempt. Opens the breaker if threshold is reached.
func (r *Registry) RecordFailure(id string) {
	s := r.getSlot(id)
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

	if s.state == HalfOpen {
		s.state = Open
		s.openedAt = now
		return
	}
	if len(pruned) >= r.opts.Threshold {
		s.state = Open
		s.openedAt = now
	}
}

// State returns the current state of a slot.
func (r *Registry) State(id string) State {
	s := r.getSlot(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == Open && r.opts.Clock().After(s.openedAt.Add(r.opts.OpenDuration)) {
		return HalfOpen
	}
	return s.state
}

func (r *Registry) getSlot(id string) *slot {
	r.mu.RLock()
	s, ok := r.entries[id]
	r.mu.RUnlock()
	if ok {
		return s
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok = r.entries[id]; ok {
		return s
	}
	s = &slot{}
	r.entries[id] = s
	return s
}

type slot struct {
	mu       sync.Mutex
	state    State
	failures []time.Time
	openedAt time.Time
	inFlight int
}
