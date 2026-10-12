package mediarelay

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/coder/websocket"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
)

// The hop (langwatch#8397). Twilio may land on any pod, but its relay
// lives on the pod that opened it. The pod Twilio reached dials the owner's hop
// listener, and only then accepts Twilio, so a dead owner is a clean 403.

var privatePrefixes = []netip.Prefix{
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"),
	// Shared address space (RFC 6598): EKS custom networking puts pods here.
	netip.MustParsePrefix("100.64.0.0/10"),
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

// hopMargin is how long past MaxRelayDuration a hopped socket may outlive the
// owner's own cap before this pod ends it.
const hopMargin = time.Second

// newHopClient builds the hop dial client. Its transport reads no proxy
// variable and its redirects are never followed, so the signed request
// reaches only the owner address the id named.
func newHopClient() *http.Client {
	return &http.Client{
		Transport:     &http.Transport{Proxy: nil, DisableKeepAlives: true, DialContext: (&net.Dialer{}).DialContext},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
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
	if hop == nil && ctx.Err() != nil {
		// Twilio gave up mid-dial: nothing to answer, and not the owner's fault.
		//nolint:nilerr // the dial error is the cancellation itself.
		return nil
	}
	if refused != "" {
		return h.refuse(ctx, id, refusal{refused, refused})
	}
	if !h.trackPump() {
		_ = hop.CloseNow()
		return h.refuse(ctx, id, refusal{OutcomeRefusedUnknown, "stopping"})
	}
	hop.SetReadLimit(readLimit)
	twilio, err := websocket.Accept(w, r, acceptOptions())
	if err != nil {
		_ = hop.CloseNow()
		h.pumps.Done()
		//nolint:nilerr // Accept already answered the request over HTTP.
		return nil
	}
	twilio.SetReadLimit(readLimit)
	h.metrics.RecordVoiceMediaRelay(OutcomeHopJoined)
	go func() {
		defer h.pumps.Done()
		h.pump(twilio, hop)
	}()
	return nil
}

// trackPump registers a pump for Stop to wait on; false once Stop has begun.
func (h *Hub) trackPump() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopped {
		return false
	}
	h.pumps.Add(1)
	return true
}

// dialOwner opens the hop socket, or answers the outcome to count. The dial
// error is never logged: it wraps the request URL, which carries the id.
func (h *Hub) dialOwner(parent context.Context, id, ownerIP string) (*websocket.Conn, string) {
	ctx, cancel := context.WithTimeout(parent, h.hopTimeout)
	defer cancel()
	path := "/relay-hop/" + id
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	header := http.Header{}
	header.Set("X-LangWatch-Gateway-Timestamp", timestamp)
	header.Set("X-LangWatch-Gateway-Signature",
		controlplane.Signature(h.secret, controlplane.Canonical{Method: http.MethodGet, Path: path, Timestamp: timestamp}))
	target := "http://" + net.JoinHostPort(ownerIP, strconv.Itoa(h.hopPort)) + path
	//nolint:bodyclose // websocket.Dial closes the response body itself.
	conn, resp, err := websocket.Dial(ctx, target, &websocket.DialOptions{
		HTTPClient: h.hopClient, HTTPHeader: header, CompressionMode: websocket.CompressionDisabled,
	})
	if err == nil {
		return conn, ""
	}
	if resp != nil && resp.StatusCode == http.StatusForbidden {
		return nil, OutcomeRefusedUnknown
	}
	if ctx.Err() != nil && parent.Err() != nil {
		return nil, ""
	}
	h.logger.Warn("relay_owner_unreachable",
		zap.String("relay", idPrefix(id)), zap.Bool("timeout", errors.Is(err, context.DeadlineExceeded)))
	return nil, OutcomeRefusedOwnerUnreachable
}

// pump copies frames both ways until either socket ends, passing close codes
// on. It ends both sockets with 1012 when the drain budget runs out, and at the
// relay maximum plus a margin, so a hop cannot outlive what the owner allows.
func (h *Hub) pump(a, b *websocket.Conn) {
	ctx, cancel := context.WithTimeout(context.Background(), h.maxDuration+hopMargin)
	defer cancel()
	p := &framePump{ctx: ctx, done: make(chan struct{}, 2)}
	go p.copy(a, b)
	go p.copy(b, a)
	select {
	case <-p.done:
	case <-h.drainOver:
		// Goroutines, so a peer that never answers its close blocks neither.
		go func() { _ = a.Close(CloseDrain, "relay_drain") }()
		go func() { _ = b.Close(CloseDrain, "relay_drain") }()
		<-p.done
	}
	// The first end closed the other side; the context bounds a silent peer.
	cancel()
	<-p.done
}

// framePump is the two copy loops of one hopped socket pair.
type framePump struct {
	ctx  context.Context
	done chan struct{}
}

func (p *framePump) copy(dst, src *websocket.Conn) {
	defer func() { p.done <- struct{}{} }()
	for {
		kind, data, err := src.Read(p.ctx)
		if err != nil {
			closeLike(dst, err)
			return
		}
		if err := dst.Write(p.ctx, kind, data); err != nil {
			_ = dst.CloseNow()
			_ = src.CloseNow()
			return
		}
	}
}

// closeLike ends dst with the close code that ended the other side, or hard
// when that side just dropped or the code cannot go on the wire.
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
	if err := dst.Close(code, closed.Reason); err != nil {
		_ = dst.CloseNow()
	}
}
