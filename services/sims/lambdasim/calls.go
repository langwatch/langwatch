package lambdasim

import (
	"fmt"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"
)

// call is one invocation the console lists; Request and Response are only in the detail answer.
type call struct {
	ID            string    `json:"id"`
	At            time.Time `json:"at"`
	Function      string    `json:"function"`
	Mode          string    `json:"mode"` // "invoke" or "stream"
	Method        string    `json:"method"`
	Path          string    `json:"path"`
	Status        int       `json:"status"` // nlpgo's, or Lambda's own when nlpgo was never reached
	FunctionError string    `json:"functionError,omitempty"`
	DurationMs    float64   `json:"durationMs"`
	Error         string    `json:"error,omitempty"`
	Request       string    `json:"request,omitempty"`
	Response      string    `json:"response,omitempty"`
}

// keep is a body as text, cut to limit bytes with a note of the full size.
func keep(raw []byte, limit int) string {
	if len(raw) <= limit {
		return string(raw)
	}
	head := raw[:limit]
	for len(head) > 0 && !utf8.Valid(head) {
		head = head[:len(head)-1]
	}
	return fmt.Sprintf("%s… [%d bytes, cut at %d]", head, len(raw), limit)
}

// ring is a bounded, newest-last buffer of calls.
type ring struct {
	mu    sync.Mutex
	items []call
	next  int
	seq   uint64
}

func newRing(size int) *ring { return &ring{items: make([]call, 0, size)} }

// add stores a call under the next id; ids keep counting across a clear.
func (r *ring) add(c call) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seq++
	c.ID = strconv.FormatUint(r.seq, 10)
	if len(r.items) < cap(r.items) {
		r.items = append(r.items, c)
		return
	}
	r.items[r.next] = c
	r.next = (r.next + 1) % len(r.items)
}

// newest lists the calls newest first.
func (r *ring) newest() []call {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]call, 0, len(r.items))
	for i := range r.items {
		out = append(out, r.items[(r.next+len(r.items)-1-i)%len(r.items)])
	}
	return out
}

func (r *ring) clear() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items, r.next = r.items[:0], 0
}
