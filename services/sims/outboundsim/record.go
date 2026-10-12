package outboundsim

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Channels a Record belongs to.
const (
	ChannelSlackWebhook = "slack-webhook"
	ChannelSlackAPI     = "slack-api"
	ChannelWebhook      = "webhook"
	ChannelSQS          = "sqs"
)

// Signature verdicts on a webhook record.
const (
	SignatureValid     = "valid"
	SignatureInvalid   = "invalid"
	SignatureUnchecked = "unchecked"
)

const redacted = "[redacted]"

// Record is one call the product made, as received and as answered.
type Record struct {
	ID         string            `json:"id"`
	Channel    string            `json:"channel"`
	Target     string            `json:"target"`
	Method     string            `json:"method"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	Truncated  bool              `json:"truncated"`
	Parsed     map[string]any    `json:"parsed"`
	EventID    string            `json:"eventId,omitempty"`
	Signature  string            `json:"signature,omitempty"`
	Status     int               `json:"status"`
	FaultID    string            `json:"faultId,omitempty"`
	Dropped    bool              `json:"dropped"`
	LatencyMs  int64             `json:"latencyMs"`
	ReceivedAt time.Time         `json:"receivedAt"`
	seeded     bool              // sample content, left out of Activity
}

// Filter narrows a listing; an empty field matches everything. Target may hold * wildcards.
type Filter struct {
	Channel string
	Target  string
	EventID string
	Since   time.Time
}

func (f Filter) matches(r Record) bool {
	return (f.Channel == "" || f.Channel == r.Channel) &&
		(f.Target == "" || glob(f.Target, r.Target)) &&
		(f.EventID == "" || f.EventID == r.EventID) &&
		(f.Since.IsZero() || !r.ReceivedAt.Before(f.Since))
}

// glob matches s against a pattern whose only metacharacter is * (any run of characters).
func glob(pattern, s string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == s
	}
	if !strings.HasPrefix(s, parts[0]) {
		return false
	}
	s = s[len(parts[0]):]
	for _, mid := range parts[1 : len(parts)-1] {
		i := strings.Index(s, mid)
		if i < 0 {
			return false
		}
		s = s[i+len(mid):]
	}
	return strings.HasSuffix(s, parts[len(parts)-1])
}

// redactHeaders flattens h, hiding every credential-bearing header's value.
func redactHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for key, values := range h {
		if sensitiveHeader(key) {
			out[key] = redacted
			continue
		}
		out[key] = strings.Join(values, ", ")
	}
	return out
}

func sensitiveHeader(name string) bool {
	n := strings.ToLower(name)
	return n == "authorization" || n == "proxy-authorization" || n == "cookie" || n == "set-cookie" ||
		strings.Contains(n, "token") || strings.Contains(n, "api-key")
}

// capBody is body as text, cut to max bytes, and whether it was cut.
func capBody(body []byte, limit int) (string, bool) {
	if len(body) > limit {
		return string(body[:limit]), true
	}
	return string(body), false
}

// store keeps the most recent records in a fixed ring: adding is O(1) and the
// oldest record is overwritten once it is full.
type store struct {
	mu   sync.Mutex
	next int
	ring []Record
	head int // index of the oldest record
	size int
}

func newStore(maxRecords int) *store {
	return &store{ring: make([]Record, maxRecords)}
}

// add stamps r with an id and the time, keeps it, and returns what was kept.
func (s *store) add(r Record, at time.Time) Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next++
	r.ID = fmt.Sprintf("rec_%06d", s.next)
	r.ReceivedAt = at
	if r.Parsed == nil {
		r.Parsed = map[string]any{}
	}
	if s.size < len(s.ring) {
		s.ring[(s.head+s.size)%len(s.ring)] = r
		s.size++
		return r
	}
	s.ring[s.head] = r
	s.head = (s.head + 1) % len(s.ring)
	return r
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

// activityWindow is how far back Activity's recent counts look.
const activityWindow = 5 * time.Minute

// Activity is how busy the stack's app has been, seeded records left out.
type Activity struct {
	Total           int        `json:"total"`
	LastFiveMinutes int        `json:"lastFiveMinutes"`
	LastReceivedAt  *time.Time `json:"lastReceivedAt"`
	LastChannel     string     `json:"lastChannel"`
}

// activity sums up the records, counting those received at or after since as recent.
// ponytail: O(n) scan of the ring per status call; keep running counters in add if it shows.
func (s *store) activity(since time.Time) Activity {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Activity{}
	for i := s.size - 1; i >= 0; i-- {
		r := s.at(i)
		if r.seeded {
			continue
		}
		out.Total++
		if out.LastReceivedAt == nil {
			at := r.ReceivedAt
			out.LastReceivedAt, out.LastChannel = &at, r.Channel
		}
		if !r.ReceivedAt.Before(since) {
			out.LastFiveMinutes++
		}
	}
	return out
}
