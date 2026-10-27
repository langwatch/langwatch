package outboundsim

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The headers a LangWatch webhook delivery carries.
const (
	headerEventID    = "X-LangWatch-Event-Id"
	headerDeliveryID = "X-LangWatch-Delivery-Id"
	headerAttempt    = "X-LangWatch-Delivery-Attempt"
	headerTestFire   = "X-LangWatch-Test-Fire"
	headerSignature  = "X-LangWatch-Signature"
)

// How a receiver answers.
const (
	modeOK       = "ok"
	modeFlaky    = "flaky"
	modeSlow     = "slow"
	modeGone     = "gone"
	modeRedirect = "redirect"
)

type receiver struct {
	secret string
	mode   string
	seeded bool
}

// receiverInfo is a receiver as the control API lists it.
type receiverInfo struct {
	Name      string `json:"name"`
	Mode      string `json:"mode"`
	HasSecret bool   `json:"hasSecret"`
}

// receiverSet holds the named /hooks/{name} receivers. A name nobody
// registered answers like "ok".
type receiverSet struct {
	mu        sync.Mutex
	byName    map[string]*receiver
	attempts  map[string]int
	slowDelay time.Duration
}

func (rs *receiverSet) mode(name string) string {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if r, ok := rs.byName[name]; ok {
		return r.mode
	}
	return modeOK
}

func (rs *receiverSet) secret(name string) string {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if r, ok := rs.byName[name]; ok {
		return r.secret
	}
	return ""
}

func (rs *receiverSet) setSecret(name, secret string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if r, ok := rs.byName[name]; ok {
		r.secret = secret
		return
	}
	rs.byName[name] = &receiver{secret: secret, mode: modeOK}
}

// clearSecret forgets the secret; a receiver outboundsim did not seed goes with it.
func (rs *receiverSet) clearSecret(name string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if r, ok := rs.byName[name]; ok && r.seeded {
		r.secret = ""
		return
	}
	delete(rs.byName, name)
}

func (rs *receiverSet) attempt(name, eventID string) int {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	key := name + "\x00" + eventID
	rs.attempts[key]++
	return rs.attempts[key]
}

func (rs *receiverSet) list() []receiverInfo {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	out := make([]receiverInfo, 0, len(rs.byName))
	for name, r := range rs.byName {
		out = append(out, receiverInfo{Name: name, Mode: r.mode, HasSecret: r.secret != ""})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// answer is the receiver's own reply, before any fault.
func (rs *receiverSet) answer(name, eventID string) reply {
	switch rs.mode(name) {
	case modeFlaky:
		if n := rs.attempt(name, eventID); n <= 2 {
			return textReply(http.StatusServiceUnavailable, fmt.Sprintf("attempt %d fails", n))
		}
	case modeSlow:
		out := textReply(http.StatusOK, "ok")
		out.latency = rs.slowDelay
		return out
	case modeGone:
		return textReply(http.StatusGone, "gone")
	case modeRedirect:
		return reply{status: http.StatusFound, header: map[string]string{"Location": "/hooks/ok"}}
	}
	return textReply(http.StatusOK, "ok")
}

func (s *Server) handleWebhook(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	c, ok := readCall(w, r, ChannelWebhook, name)
	if !ok {
		return
	}
	c.eventID = r.Header.Get(headerEventID)
	c.parsed = webhookParsed(r.Header)
	c.signature = verifySignature(s.receivers.secret(name), r.Header.Get(headerSignature), c.body)
	s.finish(w, c, s.receivers.answer(name, c.eventID))
}

// webhookParsed is the LangWatch delivery headers, named for the console.
func webhookParsed(h http.Header) map[string]any {
	out := map[string]any{}
	for key, header := range map[string]string{"eventId": headerEventID, "deliveryId": headerDeliveryID, "testFire": headerTestFire} {
		if v := h.Get(header); v != "" {
			out[key] = v
		}
	}
	if n, err := strconv.Atoi(h.Get(headerAttempt)); err == nil {
		out["attempt"] = n
	}
	return out
}

// verifySignature judges a "t=<unix>,v1=<hex>" header against the registered
// secret: HMAC-SHA256 over "<t>.<body>". No secret means unchecked.
func verifySignature(secret, header string, body []byte) string {
	if secret == "" {
		return SignatureUnchecked
	}
	var timestamp string
	var digests []string
	for _, part := range strings.Split(header, ",") {
		switch key, value, _ := strings.Cut(strings.TrimSpace(part), "="); key {
		case "t":
			timestamp = value
		case "v1":
			digests = append(digests, value)
		}
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "." + string(body)))
	want := mac.Sum(nil)
	for _, digest := range digests {
		if got, err := hex.DecodeString(digest); err == nil && hmac.Equal(got, want) {
			return SignatureValid
		}
	}
	return SignatureInvalid
}
