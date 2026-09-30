package analyticssim

import (
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"time"
)

// Providers and kinds a Record carries.
const (
	ProviderPostHog    = "posthog"
	ProviderCustomerIO = "customerio"

	KindIdentify = "identify"
	KindEvent    = "event"
	KindAlias    = "alias"
	KindGroup    = "group"
)

// Record is one call a provider would have received, in the shape common to
// both: who it is about (the PostHog distinct id or the Customer.io person
// id), its event name when it is an event, and its properties or traits.
type Record struct {
	ID         string          `json:"id"`
	Provider   string          `json:"provider"`
	Kind       string          `json:"kind"`
	DistinctID string          `json:"distinctId"`
	Name       string          `json:"name,omitempty"`
	Properties map[string]any  `json:"properties"`
	ReceivedAt time.Time       `json:"receivedAt"`
	Raw        json.RawMessage `json:"raw"`
}

// Filter narrows a listing; an empty field matches everything.
type Filter struct {
	Provider string
	Kind     string
	ID       string
	Name     string
}

func (f Filter) matches(r Record) bool {
	return (f.Provider == "" || f.Provider == r.Provider) &&
		(f.Kind == "" || f.Kind == r.Kind) &&
		(f.ID == "" || f.ID == r.DistinctID) &&
		(f.Name == "" || f.Name == r.Name)
}

// maxRecords bounds memory; the oldest record goes first.
//
// ponytail: a plain capped slice; a ring buffer if a stack ever outruns it.
const maxRecords = 5000

// store keeps the records since start, newest last.
type store struct {
	mu      sync.Mutex
	next    int
	records []Record
}

func (s *store) add(records []Record, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range records {
		s.next++
		r.ID = fmt.Sprintf("rec_%06d", s.next)
		r.ReceivedAt = at
		if r.Properties == nil {
			r.Properties = map[string]any{}
		}
		s.records = append(s.records, r)
	}
	if over := len(s.records) - maxRecords; over > 0 {
		s.records = slices.Delete(s.records, 0, over)
	}
}

// list returns the matching records, newest first.
func (s *store) list(f Filter) []Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Record{}
	for i := len(s.records) - 1; i >= 0; i-- {
		if f.matches(s.records[i]) {
			out = append(out, s.records[i])
		}
	}
	return out
}

func (s *store) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records = nil
}
