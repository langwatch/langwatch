package egress

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

// egressAdapter is the per-worker outbound forward proxy (ADR-043). It is the
// egress twin of the workerpool authProxy: the authProxy fronts a worker's
// INBOUND opencode control port; this fronts the worker's OUTBOUND traffic. The
// worker's tools (`gh`, `git`, `npm`, `curl`, `pip`) egress through it via
// HTTPS_PROXY, and the adapter enforces, per CONNECT:
//
//	rung 1a  require-TLS      — only opaque CONNECT :443 tunnels; cleartext
//	                            forwards to external hosts are refused.
//	rung 1b  throttle         — per-destination connection-burst tar-pit and
//	                            byte-rate cap (soft; slows, never a hard cliff).
//	rung 2   customer list    — presence of the list is the mode: unset ⇒
//	                            monitor-only, set ⇒ restrict to it.
//	rung 3   FQDN floor        — always-allowed structural set (github / gateway
//	                            / control plane), read from the CONNECT authority
//	                            with the TLS SNI as a cross-check.
//	rung 0   monitor          — every decision above ALSO flags (see event.go).
//
// Honest limit (ADR-043 "Where FQDN enforcement lives"): within one pod netns
// nothing forces a worker's traffic THROUGH this loopback proxy — a hostile
// worker can ignore HTTPS_PROXY and connect() straight to an external IP:443.
// This adapter is authoritative for COOPERATING clients (the primary
// mechanism) and the direct-IP bypass is still SEEN by the flow-level monitor;
// operators who need mandatory enforcement add the Cilium toFQDNs policy or the
// ADR-033 Fix B per-worker netns.
type egressAdapter struct {
	server   *http.Server
	listen   net.Listener
	port     int
	throttle *egressThrottle
	cfg      egressAdapterConfig
}

// egressAdapterConfig is everything the adapter needs, bound at spawn. The
// policy + throttle are derived from THIS worker's credentials envelope and the
// operator floor, so a policy change recycles the worker rather than mutating a
// live adapter (see domain.SignatureOf).
type egressAdapterConfig struct {
	conversationID string
	policy         egressPolicy
	throttle       throttleConfig
	monitor        egressMonitor
	// dial reaches the real upstream. Injected so tests can redirect any
	// authority to a loopback listener; production uses a bounded net.Dialer.
	dial    func(ctx context.Context, network, addr string) (net.Conn, error)
	resolve func(ctx context.Context, host string) ([]net.IP, error)
	// requireTLS refuses cleartext forwards and CONNECT to any port other than
	// tlsPort (rung 1a). On by default in production — worker egress is HTTPS
	// already, so this rung is the always-safe one.
	requireTLS bool
	tlsPort    string
	// sniCrossCheck peeks the TLS ClientHello SNI and refuses a definite
	// mismatch with the CONNECT authority (anti domain-fronting).
	sniCrossCheck  bool
	sniPeekTimeout time.Duration
	dialTimeout    time.Duration
	log            *zap.Logger
}

// startEgressAdapter binds 127.0.0.1:port and serves the forward proxy. Pass
// port 0 to bind an OS-chosen ephemeral port (the caller reads adapter.port for
// the actual value). The returned adapter is already serving; the caller closes
// it via shutdown(). Mirrors the workerpool authProxy lifecycle so the pool
// treats both per-worker proxies identically.
func startEgressAdapter(port int, cfg egressAdapterConfig) (*egressAdapter, error) {
	if cfg.log == nil {
		cfg.log = zap.NewNop()
	}
	if cfg.monitor == nil {
		cfg.monitor = newLogEgressMonitor(cfg.log)
	}
	if cfg.dial == nil {
		d := &net.Dialer{Timeout: nonZeroDuration(cfg.dialTimeout, 10*time.Second)}
		cfg.dial = d.DialContext
	}
	if cfg.tlsPort == "" {
		cfg.tlsPort = "443"
	}
	if cfg.sniPeekTimeout == 0 {
		cfg.sniPeekTimeout = 5 * time.Second
	}

	adapter := &egressAdapter{
		throttle: newEgressThrottle(cfg.throttle),
		cfg:      cfg,
	}

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("egress adapter listen %s: %w", addr, err)
	}
	adapter.listen = listener
	adapter.port = listener.Addr().(*net.TCPAddr).Port

	srv := &http.Server{
		Handler:           adapter,
		ReadHeaderTimeout: 10 * time.Second,
	}
	adapter.server = srv
	go func() {
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			cfg.log.Error("egress adapter serve exited",
				zap.String("addr", addr),
				zap.Error(err),
			)
		}
	}()
	return adapter, nil
}

// shutdown stops the adapter goroutine. Best-effort with a short deadline, to
// match the authProxy: a worker recycle must not block on draining tunnels.
func (a *egressAdapter) shutdown() {
	if a == nil || a.server == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	_ = a.server.Shutdown(ctx)
}

// ServeHTTP dispatches CONNECT tunnels; every other method is a cleartext
// forward-proxy request, which rung 1a refuses.
func (a *egressAdapter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		a.handleConnect(w, r)
		return
	}
	// Absolute-form (plain-HTTP) proxy request. The adapter only proxies opaque
	// TLS tunnels; forwarding cleartext to an external host is exactly the
	// exfil-over-plaintext path rung 1a closes. The destination never sees the
	// bytes — we answer 403 before touching the network.
	host := hostOnly(r.Host)
	if host == "" && r.URL != nil {
		host = hostOnly(r.URL.Host)
	}
	a.cfg.monitor.record(egressEvent{
		ConversationID: a.cfg.conversationID,
		Host:           host,
		Decision:       egressDeniedCleartext,
		Reason:         "cleartext http forward refused",
	})
	http.Error(w, "cleartext egress refused: HTTPS only", http.StatusForbidden)
}

// handleConnect runs the per-CONNECT decision pipeline and, when allowed,
// splices an opaque bidirectional tunnel.
func (a *egressAdapter) handleConnect(w http.ResponseWriter, r *http.Request) {
	authority := r.Host
	host, port := splitHostPortLoose(authority)
	fqdn := normalizeHost(host)

	// rung 1a: require TLS — only :443 tunnels. A CONNECT to any other port is
	// not a TLS flow we can bound, so it is refused (destination never dialed).
	if a.cfg.requireTLS && port != a.cfg.tlsPort {
		a.record(fqdn, port, egressDeniedCleartext, "connect to non-tls port", 0)
		http.Error(w, "egress refused: TLS (:443) only", http.StatusForbidden)
		return
	}

	// rungs 2/3: allow-list ∪ floor decision on the authority FQDN. The decision
	// is flagged immediately (rung 0: every decision is a monitored event, in
	// real time — not only on flow completion). On a deny we answer 403 BEFORE
	// hijacking or dialing, so the destination receives no bytes — the
	// enforcement guarantee.
	decision := a.cfg.policy.decide(fqdn)
	a.record(fqdn, port, decision, "connect decision", 0)
	if decision.blocked() {
		http.Error(w, "egress destination not allowed for this project", http.StatusForbidden)
		return
	}

	// rung 1b: per-destination throttle. Soft — a burst is tar-pitted (slowed)
	// and flagged, never hard-denied.
	tarpit, throttled := a.throttle.admitConnection(fqdn)

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		a.record(fqdn, port, decision, "hijack unsupported", 0)
		http.Error(w, "proxy misconfigured", http.StatusInternalServerError)
		return
	}
	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		a.record(fqdn, port, decision, "hijack failed: "+err.Error(), 0)
		return
	}
	defer clientConn.Close()

	if throttled && tarpit > 0 {
		a.record(fqdn, port, egressThrottled, "connection burst tar-pit", 0)
		time.Sleep(tarpit)
	}

	if _, err := io.WriteString(clientConn, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}

	// rung 3 cross-check: peek the TLS ClientHello SNI (without terminating
	// TLS) and re-run the decision against the host the client is REALLY
	// negotiating with. Catches domain-fronting — `CONNECT allowed:443` then a
	// TLS SNI of `attacker.com` on a shared CDN IP. The authority passed; if the
	// differing SNI would NOT pass the same allow set, it never reaches the
	// destination. A benign quirk (SNI differs but is itself allowed) proceeds.
	if a.cfg.sniCrossCheck {
		sni, replay, perr := peekClientHelloSNI(clientConn, a.cfg.sniPeekTimeout)
		clientConn = replay
		if perr == nil && sni != "" && sni != fqdn {
			if a.cfg.policy.decide(sni).blocked() {
				a.record(sni, port, egressDeniedSNIMismatch,
					fmt.Sprintf("sni %q not allowed (authority was %q)", sni, fqdn), 0)
				return
			}
		}
	}

	ctx := r.Context()
	dialAddress, err := a.checkedDialAddress(ctx, host, port)
	if err != nil {
		a.record(fqdn, port, egressDeniedPrivateAddress, "destination address rejected: "+err.Error(), 0)
		return
	}
	upstream, err := a.cfg.dial(ctx, "tcp", dialAddress)
	if err != nil {
		a.record(fqdn, port, decision, "upstream dial failed: "+err.Error(), 0)
		return
	}
	defer upstream.Close()

	bytesUp := a.tunnel(ctx, clientConn, upstream, fqdn)
	a.record(fqdn, port, decision, "tunnel closed", bytesUp)
}

func (a *egressAdapter) checkedDialAddress(ctx context.Context, host, port string) (string, error) {
	if a.cfg.resolve == nil {
		return net.JoinHostPort(host, port), nil
	}
	addresses, err := a.cfg.resolve(ctx, host)
	if err != nil {
		return "", fmt.Errorf("resolve host: %w", err)
	}
	for _, ip := range addresses {
		addr, ok := netip.AddrFromSlice(ip)
		if ok && isPublicEgressAddress(addr.Unmap()) {
			return net.JoinHostPort(addr.Unmap().String(), port), nil
		}
	}
	return "", fmt.Errorf("host has no public address")
}

func isPublicEgressAddress(addr netip.Addr) bool {
	if !addr.IsValid() || addr.IsUnspecified() || addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() {
		return false
	}
	if addr == netip.MustParseAddr("168.63.129.16") || addr == netip.MustParseAddr("169.254.169.254") || addr == netip.MustParseAddr("fd00:ec2::254") {
		return false
	}
	for _, prefix := range []netip.Prefix{netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("100::/64"), netip.MustParsePrefix("2001:db8::/32")} {
		if prefix.Contains(addr) {
			return false
		}
	}
	return true
}

// tunnel splices client<->upstream opaquely. The client→upstream direction
// (the exfiltration direction) is metered by the per-destination byte throttle;
// the response direction is copied plain. Either side's EOF closes both.
func (a *egressAdapter) tunnel(ctx context.Context, clientConn, upstream net.Conn, fqdn string) int64 {
	lim := a.throttle.limiterFor(fqdn)
	var bytesUp int64
	var once sync.Once
	closeBoth := func() { once.Do(func() { _ = clientConn.Close(); _ = upstream.Close() }) }

	done := make(chan struct{}, 2)
	go func() {
		n, _, _ := throttledCopy(ctx, upstream, clientConn, lim)
		atomic.AddInt64(&bytesUp, n)
		closeBoth()
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(clientConn, upstream)
		closeBoth()
		done <- struct{}{}
	}()
	<-done
	<-done
	return atomic.LoadInt64(&bytesUp)
}

// record is the single flag point — rung 0. Every decision (allow / throttle /
// deny) lands here so an enforced deny is a monitored deny.
func (a *egressAdapter) record(host, port string, decision egressDecision, reason string, bytesUp int64) {
	a.cfg.monitor.record(egressEvent{
		ConversationID: a.cfg.conversationID,
		Host:           host,
		Port:           port,
		Decision:       decision,
		Reason:         reason,
		Bytes:          bytesUp,
	})
}

// splitHostPortLoose splits an authority into host and port, tolerating a
// missing port (returns host, "").
func splitHostPortLoose(authority string) (string, string) {
	host, port, err := net.SplitHostPort(authority)
	if err != nil {
		return authority, ""
	}
	return host, port
}

// hostOnly returns the host of an authority, dropping any port.
func hostOnly(authority string) string {
	host, _ := splitHostPortLoose(authority)
	return host
}

func nonZeroDuration(v, fallback time.Duration) time.Duration {
	if v > 0 {
		return v
	}
	return fallback
}
