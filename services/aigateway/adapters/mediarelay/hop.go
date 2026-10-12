package mediarelay

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/coder/websocket"
	"go.uber.org/zap"
)

// The hop (langwatch#8397, slice 2). Twilio may land on any pod, but its relay
// lives on the pod that opened it. The pod Twilio reached dials the owner's hop
// listener, and only then accepts Twilio, so a dead owner is a clean 403.

var privatePrefixes = []netip.Prefix{
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("fc00::/7"),
}

// PrivateOwnerIP reports whether s is an IP literal in a private range. The
// owner address comes out of an id a public caller supplies; dialing only
// pod-network addresses keeps a forged id from aiming the gateway elsewhere.
func PrivateOwnerIP(s string) bool {
	addr, err := netip.ParseAddr(s)
	if err != nil || addr.Zone() != "" || addr.Is4In6() {
		return false
	}
	for _, prefix := range privatePrefixes {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// hopSignature signs a bodiless GET the way InternalAuthMiddleware verifies it.
func hopSignature(secret, path, timestamp string) string {
	empty := sha256.Sum256(nil)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("GET\n" + path + "\n" + timestamp + "\n" + hex.EncodeToString(empty[:])))
	return hex.EncodeToString(mac.Sum(nil))
}

// joinViaHop dials the owner of the relay before it accepts Twilio's socket,
// then pumps frames between the two.
func (h *Hub) joinViaHop(j joining) error {
	w, r, id, claims := j.w, j.r, j.id, j.claims
	ctx := r.Context()
	if h.podIP == "" {
		return h.refuse(ctx, id, refusal{OutcomeRefusedUnknown, "no_pod_ip"})
	}
	if !PrivateOwnerIP(claims.OwnerPodIP) {
		h.logger.Warn("relay_owner_invalid", zap.String("relay", idPrefix(id)))
		return h.refuse(ctx, id, refusal{OutcomeRefusedOwnerInvalid, "owner_invalid"})
	}
	select {
	case h.hopSlots <- struct{}{}:
	default:
		return h.refuse(ctx, id, refusal{OutcomeRefusedHopBusy, "hop_busy"})
	}
	hop, refused := h.dialOwner(ctx, id, claims.OwnerPodIP)
	<-h.hopSlots
	if refused != "" {
		return h.refuse(ctx, id, refusal{refused, refused})
	}
	hop.SetReadLimit(readLimit)
	twilio, err := websocket.Accept(w, r, acceptOptions())
	if err != nil {
		_ = hop.CloseNow()
		//nolint:nilerr // Accept already answered the request over HTTP.
		return nil
	}
	twilio.SetReadLimit(readLimit)
	h.metrics.RecordVoiceMediaRelay(OutcomeHopJoined)
	go pump(twilio, hop)
	return nil
}

// dialOwner opens the hop socket, or answers the outcome to count. The dial
// error is never logged: it wraps the request URL, which carries the id.
func (h *Hub) dialOwner(ctx context.Context, id, ownerIP string) (*websocket.Conn, string) {
	ctx, cancel := context.WithTimeout(ctx, h.hopTimeout)
	defer cancel()
	path := "/relay-hop/" + id
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	header := http.Header{}
	header.Set("X-LangWatch-Gateway-Timestamp", timestamp)
	header.Set("X-LangWatch-Gateway-Signature", hopSignature(h.secret, path, timestamp))
	target := "http://" + net.JoinHostPort(ownerIP, strconv.Itoa(h.hopPort)) + path
	//nolint:bodyclose // websocket.Dial closes the response body itself.
	conn, resp, err := websocket.Dial(ctx, target, &websocket.DialOptions{
		HTTPHeader: header, CompressionMode: websocket.CompressionDisabled,
	})
	if err == nil {
		return conn, ""
	}
	if resp != nil && resp.StatusCode == http.StatusForbidden {
		return nil, OutcomeRefusedUnknown
	}
	h.logger.Warn("relay_owner_unreachable",
		zap.String("relay", idPrefix(id)), zap.Bool("timeout", errors.Is(err, context.DeadlineExceeded)))
	return nil, OutcomeRefusedOwnerUnreachable
}

// pump copies frames both ways until either socket ends, passing close codes on.
func pump(a, b *websocket.Conn) {
	done := make(chan struct{}, 2)
	go copyFrames(a, b, done)
	go copyFrames(b, a, done)
	<-done
	<-done
}

func copyFrames(dst, src *websocket.Conn, done chan<- struct{}) {
	defer func() { done <- struct{}{} }()
	for {
		kind, data, err := src.Read(context.Background())
		if err != nil {
			closeLike(dst, err)
			return
		}
		if err := dst.Write(context.Background(), kind, data); err != nil {
			_ = src.CloseNow()
			return
		}
	}
}

// closeLike ends dst with the close code that ended the other side, or hard
// when that side just dropped.
func closeLike(dst *websocket.Conn, readErr error) {
	var closed websocket.CloseError
	if !errors.As(readErr, &closed) {
		_ = dst.CloseNow()
		return
	}
	code := closed.Code
	if code == websocket.StatusNoStatusRcvd {
		code = websocket.StatusNormalClosure
	}
	_ = dst.Close(code, closed.Reason)
}
