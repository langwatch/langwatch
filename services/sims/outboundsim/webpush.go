package outboundsim

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// ChannelPush records the Web Push sends the product makes to a subscription whose endpoint
// is outboundsim's /push/{device}.
const ChannelPush = "push"

// pushDevices is what each stand-in device received, and the answer it was told to give.
type pushDevices struct {
	mu      sync.Mutex
	sends   map[string]*PushDevice
	answers map[string]int
}

// PushDevice is one device's tally, as GET /_sim/api/push lists it.
type PushDevice struct {
	Device     string `json:"device"`
	Sends      int    `json:"sends"`
	Delivered  int    `json:"delivered"`
	LastStatus int    `json:"lastStatus"`
	LastTopic  string `json:"lastTopic,omitempty"`
	LastTTL    string `json:"lastTtl,omitempty"`
	LastAt     string `json:"lastAt"`
	Answer     int    `json:"answer,omitempty"`
}

func newPushDevices() *pushDevices {
	return &pushDevices{sends: map[string]*PushDevice{}, answers: map[string]int{}}
}

// vapidClaims are the JWT claims RFC 8292 requires of a push sender.
type vapidClaims struct {
	Aud string `json:"aud"`
	Exp int64  `json:"exp"`
	Sub string `json:"sub"`
}

// vapidOf reads the RFC 8292 header (`vapid t=<jwt>, k=<key>`) or the older
// `WebPush <jwt>` with Crypto-Key p256ecdsa=<key>.
func vapidOf(r *http.Request) (token, key string) {
	auth := r.Header.Get("Authorization")
	if rest, ok := strings.CutPrefix(auth, "vapid "); ok {
		for _, part := range strings.Split(rest, ",") {
			name, value, _ := strings.Cut(strings.TrimSpace(part), "=")
			switch name {
			case "t":
				token = value
			case "k":
				key = value
			}
		}
		return token, key
	}
	if rest, ok := strings.CutPrefix(auth, "WebPush "); ok {
		for _, part := range strings.Split(r.Header.Get("Crypto-Key"), ";") {
			if value, found := strings.CutPrefix(strings.TrimSpace(part), "p256ecdsa="); found {
				key = value
			}
		}
		return strings.TrimSpace(rest), key
	}
	return "", ""
}

// verifyVapid checks the ES256 signature under key, that aud is the origin the send reached
// and that exp is in the future and at most a day ahead, as the browser push services do.
func verifyVapid(token, key, origin string, now time.Time) (vapidClaims, error) {
	var claims vapidClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 || key == "" {
		return claims, errors.New("missing VAPID token or key")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(key, "="))
	if err != nil {
		return claims, errors.New("VAPID key is not base64url")
	}
	pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), raw)
	if err != nil {
		return claims, errors.New("VAPID key is not a P-256 point")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 {
		return claims, errors.New("VAPID signature is not a 64-byte ES256 signature")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(pub, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		return claims, errors.New("VAPID signature does not verify under k")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(payload, &claims) != nil {
		return claims, errors.New("VAPID claims are not JSON")
	}
	switch {
	case claims.Aud != origin:
		return claims, errors.New("VAPID aud " + claims.Aud + " is not " + origin)
	case claims.Exp <= now.Unix() || claims.Exp > now.Add(24*time.Hour).Unix():
		return claims, errors.New("VAPID exp is not within the next 24 hours")
	case !strings.HasPrefix(claims.Sub, "mailto:") && !strings.HasPrefix(claims.Sub, "https:"):
		return claims, errors.New("VAPID sub must be a mailto: or https: contact")
	}
	return claims, nil
}

// handlePush is a push service: POST /push/{device} takes one VAPID-signed, aes128gcm-encrypted
// message (201). A bad signature is 403 as FCM answers; a device whose name holds "gone" or that
// PUT /_sim/api/push/{device} told to, answers 410 (or 404, 429) so the sender drops it.
func (s *Server) handlePush(w http.ResponseWriter, r *http.Request) {
	device := r.PathValue("device")
	c, ok := readCall(w, r, ChannelPush, device)
	if !ok {
		return
	}
	token, key := vapidOf(r)
	claims, vapidErr := verifyVapid(token, key, originOf(r), s.now())
	c.parsed = map[string]any{
		"device": device, "ttl": r.Header.Get("TTL"), "urgency": r.Header.Get("Urgency"), "topic": r.Header.Get("Topic"),
		"contentEncoding": r.Header.Get("Content-Encoding"), "bytes": len(c.body), "sub": claims.Sub,
	}
	out := textReply(http.StatusCreated, "")
	answer := s.push.answerFor(device)
	switch {
	case vapidErr != nil:
		out = textReply(http.StatusForbidden, "invalid VAPID credentials: "+vapidErr.Error())
	case r.Header.Get("TTL") == "":
		out = textReply(http.StatusBadRequest, "TTL header is required")
	case len(c.body) > 0 && r.Header.Get("Content-Encoding") != "aes128gcm":
		out = textReply(http.StatusBadRequest, "Content-Encoding must be aes128gcm")
	case len(c.body) > 4096:
		out = textReply(http.StatusRequestEntityTooLarge, "payload exceeds 4096 bytes")
	case answer != 0:
		out = textReply(answer, http.StatusText(answer))
		if answer == http.StatusTooManyRequests {
			out.header = map[string]string{"Retry-After": "30"}
		}
	default:
		out.header = map[string]string{"Location": originOf(r) + "/push/" + device + "/messages/" + s.now().Format("150405.000000")}
	}
	s.push.tally(device, out.status, r.Header.Get("Topic"), r.Header.Get("TTL"), s.now())
	s.finish(w, c, out)
}

func (p *pushDevices) answerFor(device string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if status, set := p.answers[device]; set {
		return status
	}
	lower := strings.ToLower(device)
	switch {
	case strings.Contains(lower, "gone"):
		return http.StatusGone
	case strings.Contains(lower, "notfound"):
		return http.StatusNotFound
	case strings.Contains(lower, "ratelimited"):
		return http.StatusTooManyRequests
	}
	return 0
}

func (p *pushDevices) tally(device string, status int, topic, ttl string, at time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	d := p.sends[device]
	if d == nil {
		d = &PushDevice{Device: device}
		p.sends[device] = d
	}
	d.Sends++
	if status == http.StatusCreated {
		d.Delivered++
	}
	d.LastStatus, d.LastTopic, d.LastTTL, d.LastAt = status, topic, ttl, at.UTC().Format(time.RFC3339)
}

// handlePushDevices lists every device that was sent to, or told how to answer.
func (s *Server) handlePushDevices(w http.ResponseWriter, _ *http.Request) {
	s.push.mu.Lock()
	out := []PushDevice{}
	seen := map[string]bool{}
	for name, d := range s.push.sends {
		row := *d
		row.Answer = s.push.answers[name]
		out, seen[name] = append(out, row), true
	}
	for name, status := range s.push.answers {
		if !seen[name] {
			out = append(out, PushDevice{Device: name, Answer: status})
		}
	}
	s.push.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].Device < out[j].Device })
	writeJSON(w, http.StatusOK, map[string]any{"devices": out})
}

// handleSetPushAnswer makes one device answer {"status": 404|410|429|500} from now on.
func (s *Server) handleSetPushAnswer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Status int `json:"status"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Status < 400 || body.Status > 599 {
		writeFieldError(w, fieldError{"status", "must be an error status between 400 and 599"})
		return
	}
	s.push.mu.Lock()
	s.push.answers[r.PathValue("device")] = body.Status
	s.push.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"device": r.PathValue("device"), "status": body.Status})
}

// handleClearPushAnswer puts a device back to accepting sends.
func (s *Server) handleClearPushAnswer(w http.ResponseWriter, r *http.Request) {
	s.push.mu.Lock()
	delete(s.push.answers, r.PathValue("device"))
	s.push.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}
