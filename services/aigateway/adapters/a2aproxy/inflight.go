package a2aproxy

import "sync"

// maxInFlightPerKey bounds the A2A calls one virtual key runs at once, so one
// key cannot hold the pod's memory with parallel bodies.
const maxInFlightPerKey = 8

// inflight counts the calls each virtual key has open.
type inflight struct {
	mu    sync.Mutex
	count map[string]int
}

func (f *inflight) acquire(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.count == nil {
		f.count = map[string]int{}
	}
	if f.count[key] >= maxInFlightPerKey {
		return false
	}
	f.count[key]++
	return true
}

func (f *inflight) release(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.count[key] <= 1 {
		delete(f.count, key)
		return
	}
	f.count[key]--
}
