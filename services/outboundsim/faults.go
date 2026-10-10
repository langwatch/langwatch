package outboundsim

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Fault makes matching calls fail, stall or drop. The first fault that matches
// a call answers it; Times counts down and the fault deletes itself at zero.
type Fault struct {
	ID         string `json:"id"`
	Channel    string `json:"channel"`
	Target     string `json:"target"`
	Status     int    `json:"status"`
	Body       string `json:"body,omitempty"`
	RetryAfter int    `json:"retryAfter,omitempty"`
	LatencyMs  int    `json:"latencyMs,omitempty"`
	Drop       bool   `json:"drop,omitempty"`
	Times      int    `json:"times,omitempty"`
}

// fieldError names the request field that failed validation.
type fieldError struct {
	Field   string
	Message string
}

func (e fieldError) Error() string { return e.Field + ": " + e.Message }

var knownChannels = map[string]bool{ChannelSlackWebhook: true, ChannelSlackAPI: true, ChannelWebhook: true, ChannelSQS: true}

// validate refuses a fault that could never answer anything, naming the field.
func (f Fault) validate() error {
	switch {
	case f.Channel != "" && !knownChannels[f.Channel]:
		return fieldError{"channel", "must be slack-webhook, slack-api, webhook or sqs"}
	case f.Status != 0 && (f.Status < 100 || f.Status > 599):
		return fieldError{"status", "must be 0 or between 100 and 599"}
	case f.LatencyMs < 0:
		return fieldError{"latencyMs", "must not be negative"}
	case f.RetryAfter < 0:
		return fieldError{"retryAfter", "must not be negative"}
	case f.Times < 0:
		return fieldError{"times", "must not be negative"}
	case f.Status == 0 && f.LatencyMs == 0 && !f.Drop:
		return fieldError{"status", "a fault needs a status, a latency or drop"}
	}
	return nil
}

// apply is the answer natural becomes under f, and whether the connection drops.
func (f Fault) apply(natural reply) (reply, bool) {
	out := natural
	out.latency += time.Duration(f.LatencyMs) * time.Millisecond
	if f.Status == 0 {
		return out, f.Drop
	}
	out.status, out.contentType, out.body = f.Status, "text/plain", f.Body
	if f.Body == "" {
		out.body = http.StatusText(f.Status)
	}
	if f.RetryAfter > 0 {
		out.header = map[string]string{"Retry-After": fmt.Sprint(f.RetryAfter)}
	}
	return out, f.Drop
}

type faultSet struct {
	mu     sync.Mutex
	nextID int
	faults []*Fault
}

func (s *faultSet) add(f Fault) Fault {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	f.ID = fmt.Sprintf("fault_%d", s.nextID)
	s.faults = append(s.faults, &f)
	return f
}

func (s *faultSet) list() []Fault {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Fault, 0, len(s.faults))
	for _, f := range s.faults {
		out = append(out, *f)
	}
	return out
}

func (s *faultSet) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.faults)
}

func (s *faultSet) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.faults = nil
}

func (s *faultSet) remove(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, f := range s.faults {
		if f.ID == id {
			s.faults = append(s.faults[:i], s.faults[i+1:]...)
			return true
		}
	}
	return false
}

// take is the first fault matching the call, with its Times counted down.
func (s *faultSet) take(channel, target string) (Fault, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, f := range s.faults {
		if (f.Channel != "" && f.Channel != channel) || (f.Target != "" && !glob(f.Target, target)) {
			continue
		}
		hit := *f
		if f.Times > 0 {
			f.Times--
			if f.Times == 0 {
				s.faults = append(s.faults[:i], s.faults[i+1:]...)
			}
		}
		return hit, true
	}
	return Fault{}, false
}
