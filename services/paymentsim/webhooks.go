package paymentsim

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"sync"
	"time"
)

// apiVersion is the version the product's client pins; events carry it.
const apiVersion = "2024-04-10"

// Event is Stripe's event object; data.object is a snapshot taken when it fired.
type Event struct {
	ID              string         `json:"id"`
	Object          string         `json:"object"`
	APIVersion      string         `json:"api_version"`
	Created         int64          `json:"created"`
	Data            EventData      `json:"data"`
	Livemode        bool           `json:"livemode"`
	PendingWebhooks int            `json:"pending_webhooks"`
	Request         map[string]any `json:"request"`
	Type            string         `json:"type"`
}

// EventData is the object and, on an update, the fields it changed from.
type EventData struct {
	Object             json.RawMessage `json:"object"`
	PreviousAttributes map[string]any  `json:"previous_attributes,omitempty"`
}

// Attempt is one delivery of an event and the endpoint's answer.
type Attempt struct {
	At     int64  `json:"at"`
	Status int    `json:"status"`
	Error  string `json:"error,omitempty"`
	// Signed is "configured" for the configured secret, "other" for a forced one.
	Signed string `json:"signed"`
}

// EventRecord is an event and every attempt to deliver it.
type EventRecord struct {
	Event    Event     `json:"event"`
	Attempts []Attempt `json:"attempts"`
	payload  []byte
}

// hooks keeps every event and delivers them, in order, to one endpoint.
type hooks struct {
	mu      sync.Mutex
	url     string
	secret  string
	real    func() time.Time
	client  *http.Client
	events  []*EventRecord
	pending []string
	held    bool
	wake    chan struct{}
}

func newHooks(url, secret string, real func() time.Time) *hooks {
	return &hooks{url: url, secret: secret, real: real, client: &http.Client{Timeout: 30 * time.Second}, wake: make(chan struct{}, 1)}
}

// sign is Stripe's scheme: t=<unix>,v1=hex(HMAC-SHA256(secret, "<t>.<payload>")).
// The timestamp is the wall clock, never the simulated one, so the receiver's
// five-minute tolerance holds after the clock is advanced.
func sign(secret string, at int64, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%d.", at)
	_, _ = mac.Write(payload)
	return fmt.Sprintf("t=%d,v1=%s", at, hex.EncodeToString(mac.Sum(nil)))
}

func (h *hooks) add(evt Event) {
	payload, _ := json.Marshal(evt)
	h.mu.Lock()
	h.events = append(h.events, &EventRecord{Event: evt, Attempts: []Attempt{}, payload: payload})
	if h.url != "" {
		h.pending = append(h.pending, evt.ID)
	}
	h.mu.Unlock()
	h.poke()
}

func (h *hooks) poke() {
	select {
	case h.wake <- struct{}{}:
	default:
	}
}

// run delivers pending events oldest first until ctx is done; a held queue waits.
func (h *hooks) run(ctx context.Context) {
	for {
		h.mu.Lock()
		var next string
		if !h.held && len(h.pending) > 0 {
			next, h.pending = h.pending[0], h.pending[1:]
		}
		h.mu.Unlock()
		if next != "" {
			h.deliver(ctx, next, h.secret)
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-h.wake:
		}
	}
}

func (h *hooks) find(id string) *EventRecord {
	for _, rec := range h.events {
		if rec.Event.ID == id {
			return rec
		}
	}
	return nil
}

// deliver posts one event signed with secret and records the answer.
func (h *hooks) deliver(ctx context.Context, id, secret string) Attempt {
	h.mu.Lock()
	rec, url := h.find(id), h.url
	h.mu.Unlock()
	if rec == nil {
		return Attempt{Error: "no such event"}
	}
	at := h.real().Unix()
	attempt := Attempt{At: at, Signed: "configured"}
	if secret != h.secret {
		attempt.Signed = "other"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(rec.payload))
	if err == nil {
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
		req.Header.Set("User-Agent", "Stripe/1.0 (+https://stripe.com/docs/webhooks)")
		req.Header.Set("Stripe-Signature", sign(secret, at, rec.payload))
		var resp *http.Response
		if resp, err = h.client.Do(req); err == nil {
			attempt.Status = resp.StatusCode
			_ = resp.Body.Close()
		}
	}
	if err != nil {
		attempt.Error = err.Error()
	}
	h.mu.Lock()
	rec.Attempts = append(rec.Attempts, attempt)
	h.mu.Unlock()
	return attempt
}

// deliverNow posts ids in the order given, now, taking them off the queue: a
// repeated id is a duplicate delivery, a reversed list is out of order.
func (h *hooks) deliverNow(ctx context.Context, ids []string, secret string) ([]Attempt, error) {
	h.mu.Lock()
	if h.url == "" {
		h.mu.Unlock()
		return nil, fmt.Errorf("no webhook endpoint is configured (PAYMENTSIM_WEBHOOK_URL)")
	}
	for _, id := range ids {
		if h.find(id) == nil {
			h.mu.Unlock()
			return nil, fmt.Errorf("no such event: %s", id)
		}
	}
	keep := h.pending[:0]
	for _, p := range h.pending {
		if !slices.Contains(ids, p) {
			keep = append(keep, p)
		}
	}
	h.pending = keep
	h.mu.Unlock()
	if secret == "" {
		secret = h.secret
	}
	out := make([]Attempt, 0, len(ids))
	for _, id := range ids {
		out = append(out, h.deliver(ctx, id, secret))
	}
	return out, nil
}

func (h *hooks) hold(held bool) {
	h.mu.Lock()
	h.held = held
	h.mu.Unlock()
	h.poke()
}

// snapshot is every event record and the ids still queued.
func (h *hooks) snapshot() ([]EventRecord, []string, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]EventRecord, 0, len(h.events))
	for _, rec := range h.events {
		out = append(out, EventRecord{Event: rec.Event, Attempts: append([]Attempt{}, rec.Attempts...)})
	}
	return out, append([]string{}, h.pending...), h.held
}

func (h *hooks) reset() {
	h.mu.Lock()
	h.events, h.pending = nil, nil
	h.mu.Unlock()
}
