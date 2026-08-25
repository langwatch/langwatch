package idpsim

import "time"

// activityLimit is how many events a tenant keeps. A login attempt is a
// handful of events and a developer only ever looks at the recent ones, so the
// ring stays small and the page stays readable.
const activityLimit = 200

// Outcome is how a request ended, in the two words that matter when you are
// staring at a login that did not work.
const (
	OutcomeOK      = "ok"
	OutcomeRefused = "refused"
)

// Event is one thing that happened to a tenant: a request arrived and was
// served or refused. It exists so "is my identity provider configuration
// right?" has an answer other than reading server logs — the tenant page shows
// these newest-first, and a refusal always carries the reason.
type Event struct {
	At      time.Time `json:"at"`
	Kind    string    `json:"kind"`
	Outcome string    `json:"outcome"`
	// Client is the relying party as it identified itself: an OAuth client id,
	// or a SAML service provider's entity id.
	Client string `json:"client,omitempty"`
	// Subject is the user the request was about, when there was one.
	Subject string `json:"subject,omitempty"`
	// Detail is one plain sentence: what happened, or why it was refused.
	Detail string `json:"detail"`
}

// Record appends an event to the tenant's ring.
func (t *Tenant) Record(ev Event) {
	if ev.At.IsZero() {
		ev.At = time.Now()
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.events = append(t.events, ev)
	if len(t.events) > activityLimit {
		t.events = t.events[len(t.events)-activityLimit:]
	}
}

// Activity returns the tenant's events newest-first.
func (t *Tenant) Activity() []Event {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]Event, 0, len(t.events))
	for i := len(t.events) - 1; i >= 0; i-- {
		out = append(out, t.events[i])
	}
	return out
}

// record is the server's shorthand, so handlers read as one line per outcome.
func (s *Server) record(t *Tenant, kind, outcome, client, subject, detail string) {
	t.Record(Event{
		At: s.now(), Kind: kind, Outcome: outcome,
		Client: client, Subject: subject, Detail: detail,
	})
}
