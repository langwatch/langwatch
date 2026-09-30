package analyticssim

import (
	"encoding/json"
	"fmt"
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

// store keeps the most recent records since start in a fixed ring: adding is
// O(1) and the oldest record is overwritten once it is full.
type store struct {
	mu     sync.Mutex
	next   int
	ring   []Record
	head   int // index of the oldest record
	size   int
	maxRaw int
}

func newStore(maxRecords, maxRawBytes int) store {
	return store{ring: make([]Record, maxRecords), maxRaw: maxRawBytes}
}

func (s *store) add(records []Record, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range records {
		r := records[i]
		s.next++
		r.ID = fmt.Sprintf("rec_%06d", s.next)
		r.ReceivedAt = at
		if r.Properties == nil {
			r.Properties = map[string]any{}
		}
		if len(r.Raw) > s.maxRaw {
			r.Raw = json.RawMessage(fmt.Sprintf(`{"truncated":true,"bytes":%d}`, len(r.Raw)))
		}
		if s.size < len(s.ring) {
			s.ring[(s.head+s.size)%len(s.ring)] = r
			s.size++
			continue
		}
		s.ring[s.head] = r
		s.head = (s.head + 1) % len(s.ring)
	}
}

// at is the i-th record, oldest first.
func (s *store) at(i int) Record { return s.ring[(s.head+i)%len(s.ring)] }

// list returns the matching records, newest first.
func (s *store) list(f Filter) []Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Record{}
	for i := s.size - 1; i >= 0; i-- {
		if r := s.at(i); f.matches(r) {
			out = append(out, r)
		}
	}
	return out
}

func (s *store) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.size
}

func (s *store) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	clear(s.ring)
	s.head, s.size = 0, 0
}
