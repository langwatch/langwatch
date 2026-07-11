package egress

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
)

// These tests are the executable acceptance bar for
// specs/langy/langy-egress-enforcement.feature (ADR-043). They exercise the
// adapter's decision pipeline end-to-end (a real CONNECT over a loopback
// socket), not string assertions: a denied destination must never be dialed,
// a cleartext forward must be refused, a listed host must tunnel, and the
// per-destination throttle must slow one host without slowing another.

// waitForListenerOrFail blocks until the adapter's loopback port accepts a
// connection, so a test never races the serve goroutine's bind.
func waitForListenerOrFail(t *testing.T, port int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 50*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("egress adapter did not bind 127.0.0.1:%d in time", port)
}

// recordingMonitor captures every flagged decision so a test can assert that
// enforcement is ALSO monitored (rung 0).
type recordingMonitor struct {
	mu     sync.Mutex
	events []egressEvent
}

func (m *recordingMonitor) record(e egressEvent) {
	m.mu.Lock()
	m.events = append(m.events, e)
	m.mu.Unlock()
}

func (m *recordingMonitor) decisions() []egressDecision {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]egressDecision, 0, len(m.events))
	for _, e := range m.events {
		out = append(out, e.Decision)
	}
	return out
}

func (m *recordingMonitor) has(d egressDecision) bool {
	for _, got := range m.decisions() {
		if got == d {
			return true
		}
	}
	return false
}

// echoUpstream is a stand-in destination that echoes whatever it receives, so
// an established tunnel is observable end-to-end.
type echoUpstream struct {
	ln       net.Listener
	accepted int32
	mu       sync.Mutex
}

func startEchoUpstream(t *testing.T) *echoUpstream {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("echo listen: %v", err)
	}
	e := &echoUpstream{ln: ln}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			e.mu.Lock()
			e.accepted++
			e.mu.Unlock()
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 4096)
				for {
					n, err := c.Read(buf)
					if n > 0 {
						_, _ = c.Write(buf[:n])
					}
					if err != nil {
						return
					}
				}
			}(conn)
		}
	}()
	t.Cleanup(func() { _ = ln.Close() })
	return e
}

func (e *echoUpstream) accepts() int32 {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.accepted
}

// dialRecorder wraps a dial func to (a) record which authorities were dialed
// and (b) route every dial to the echo upstream regardless of the requested
// host, so realistic FQDNs can be used while everything lands on loopback.
type dialRecorder struct {
	echoAddr string
	mu       sync.Mutex
	dialed   []string
}

func (d *dialRecorder) dial(ctx context.Context, network, addr string) (net.Conn, error) {
	d.mu.Lock()
	d.dialed = append(d.dialed, addr)
	d.mu.Unlock()
	return net.Dial("tcp", d.echoAddr)
}

func (d *dialRecorder) dialedAuthority(authority string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, a := range d.dialed {
		if a == authority {
			return true
		}
	}
	return false
}

// harness bundles an adapter with its monitor + dial recorder.
type harness struct {
	adapter  *egressAdapter
	monitor  *recordingMonitor
	dialer   *dialRecorder
	proxyURL string
}

func newHarness(t *testing.T, cfg egressAdapterConfig) *harness {
	t.Helper()
	echo := startEchoUpstream(t)
	mon := &recordingMonitor{}
	dialer := &dialRecorder{echoAddr: echo.ln.Addr().String()}
	cfg.monitor = mon
	cfg.dial = dialer.dial
	cfg.log = zap.NewNop()

	adapter, err := startEgressAdapter(0, cfg)
	if err != nil {
		t.Fatalf("startEgressAdapter: %v", err)
	}
	t.Cleanup(adapter.shutdown)
	waitForListenerOrFail(t, adapter.port)

	return &harness{
		adapter:  adapter,
		monitor:  mon,
		dialer:   dialer,
		proxyURL: fmt.Sprintf("127.0.0.1:%d", adapter.port),
	}
}

// sendCONNECT dials the proxy and issues a CONNECT for authority, returning the
// raw connection (positioned at the tunnel start) and the HTTP status code.
func (h *harness) sendCONNECT(t *testing.T, authority string) (net.Conn, int) {
	t.Helper()
	conn, err := net.Dial("tcp", h.proxyURL)
	if err != nil {
		t.Fatalf("dial proxy: %v", err)
	}
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", authority, authority); err != nil {
		t.Fatalf("write CONNECT: %v", err)
	}
	return conn, readResponseStatus(t, conn)
}

// readResponseStatus reads bytes up to the header terminator and parses the
// status code, leaving the connection positioned exactly at the tunnel start
// (no over-read into tunnel bytes).
func readResponseStatus(t *testing.T, conn net.Conn) int {
	t.Helper()
	var buf []byte
	one := make([]byte, 1)
	for {
		n, err := conn.Read(one)
		if n > 0 {
			buf = append(buf, one[0])
			if bytes.HasSuffix(buf, []byte("\r\n\r\n")) {
				break
			}
		}
		if err != nil {
			t.Fatalf("read response head: %v (got %q)", err, buf)
		}
	}
	line := string(buf)
	fields := strings.SplitN(line, " ", 3)
	if len(fields) < 2 {
		t.Fatalf("malformed status line: %q", line)
	}
	code, err := strconv.Atoi(fields[1])
	if err != nil {
		t.Fatalf("parse status code from %q: %v", line, err)
	}
	return code
}

func baseCfg() egressAdapterConfig {
	return egressAdapterConfig{
		conversationID: "conv-egress-test",
		throttle:       defaultThrottleConfig(),
		requireTLS:     true,
		sniCrossCheck:  false,
	}
}

// ---- Rung 2: allow-list set means restrict to it ----

func TestEgress_ListedHostIsAllowedAndTunnels(t *testing.T) {
	cfg := baseCfg()
	cfg.policy = egressPolicy{allowlist: []string{"registry.npmjs.org"}}
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "registry.npmjs.org:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("listed host got status %d, want 200", status)
	}

	// The tunnel is real: bytes we write echo back through the upstream.
	if _, err := conn.Write([]byte("ping")); err != nil {
		t.Fatalf("tunnel write: %v", err)
	}
	got := make([]byte, 4)
	if _, err := conn.Read(got); err != nil {
		t.Fatalf("tunnel read: %v", err)
	}
	if string(got) != "ping" {
		t.Fatalf("tunnel echoed %q, want %q", got, "ping")
	}
	if !h.dialer.dialedAuthority("registry.npmjs.org:443") {
		t.Fatalf("expected the listed host to be dialed")
	}
	if !h.monitor.has(egressAllowedListed) {
		t.Fatalf("expected an allowed_listed flag, got %v", h.monitor.decisions())
	}
}

func TestEgress_NonListedHostIsDeniedAndNeverDialed(t *testing.T) {
	cfg := baseCfg()
	cfg.policy = egressPolicy{allowlist: []string{"registry.npmjs.org"}}
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "attacker.example.com:443")
	defer conn.Close()
	if status != 403 {
		t.Fatalf("non-listed host got status %d, want 403", status)
	}
	// The security-critical assertion: the destination is never contacted, so
	// no bytes could leave the pod toward it.
	if h.dialer.dialedAuthority("attacker.example.com:443") {
		t.Fatalf("denied destination was dialed — bytes could have leaked")
	}
	if !h.monitor.has(egressDenied) {
		t.Fatalf("expected a denied flag, got %v", h.monitor.decisions())
	}
}

// ---- Rung 2 default: no allow-list means monitor, not block ----

func TestEgress_NoAllowlistAllowsButFlagsMonitorOnly(t *testing.T) {
	cfg := baseCfg()
	cfg.policy = egressPolicy{} // no customer list, floor unset, enforceFloor off
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "some-new-host.example:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("monitor-only host got status %d, want 200 (nothing blocked)", status)
	}
	if !h.dialer.dialedAuthority("some-new-host.example:443") {
		t.Fatalf("expected the host to be dialed in monitor-only mode")
	}
	if !h.monitor.has(egressAllowedMonitor) {
		t.Fatalf("expected an allowed_monitor flag, got %v", h.monitor.decisions())
	}
	if h.monitor.has(egressDenied) {
		t.Fatalf("monitor-only mode must not deny on allow-list grounds")
	}
}

// ---- Rung 3: always-on FQDN floor ----

func TestEgress_FloorHostAllowedEvenUnderRestrictiveList(t *testing.T) {
	cfg := baseCfg()
	// Customer restricts to one host; the floor must still let structural
	// destinations (github) through — floor ∪ list, floor is additive.
	cfg.policy = egressPolicy{
		allowlist: []string{"registry.npmjs.org"},
		floor:     []string{"github.com", "api.github.com"},
	}
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "api.github.com:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("floor host got status %d, want 200", status)
	}
	if !h.monitor.has(egressAllowedFloor) {
		t.Fatalf("expected an allowed_floor flag, got %v", h.monitor.decisions())
	}
}

func TestEgress_EmptyListDoesNotWidenOrDenyOutsideFloor(t *testing.T) {
	cfg := baseCfg()
	// Floor configured, no customer list, floor NOT enforced (default): a host
	// outside the floor is allowed (monitor-only), not denied and not
	// allow-listed.
	cfg.policy = egressPolicy{floor: []string{"github.com"}, enforceFloor: false}
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "outside-floor.example:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("outside-floor host got status %d, want 200 (monitor-only)", status)
	}
	if !h.monitor.has(egressAllowedMonitor) {
		t.Fatalf("expected allowed_monitor, got %v", h.monitor.decisions())
	}
}

func TestEgress_EnforceFloorDeniesOutsideFloorWithoutCustomerList(t *testing.T) {
	cfg := baseCfg()
	// Operator flips the rung-3 lever: the floor becomes a hard ceiling even
	// without a customer list.
	cfg.policy = egressPolicy{floor: []string{"github.com"}, enforceFloor: true}
	h := newHarness(t, cfg)

	denied, status := h.sendCONNECT(t, "outside-floor.example:443")
	defer denied.Close()
	if status != 403 {
		t.Fatalf("with enforceFloor on, outside-floor host got %d, want 403", status)
	}
	if h.dialer.dialedAuthority("outside-floor.example:443") {
		t.Fatalf("enforced-floor deny must not dial the destination")
	}

	allowed, status := h.sendCONNECT(t, "github.com:443")
	defer allowed.Close()
	if status != 200 {
		t.Fatalf("floor host under enforceFloor got %d, want 200", status)
	}
}

// ---- Rung 1a: require TLS ----

func TestEgress_CleartextForwardIsRefused(t *testing.T) {
	cfg := baseCfg()
	cfg.policy = egressPolicy{} // even monitor-only refuses cleartext
	h := newHarness(t, cfg)

	conn, err := net.Dial("tcp", h.proxyURL)
	if err != nil {
		t.Fatalf("dial proxy: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	// Absolute-form plain-HTTP proxy request (cleartext), not a CONNECT.
	if _, err := fmt.Fprintf(conn,
		"GET http://attacker.example.com/steal HTTP/1.1\r\nHost: attacker.example.com\r\n\r\n"); err != nil {
		t.Fatalf("write plain request: %v", err)
	}
	status := readResponseStatus(t, conn)
	if status != 403 {
		t.Fatalf("cleartext forward got status %d, want 403", status)
	}
	if h.dialer.dialedAuthority("attacker.example.com:80") {
		t.Fatalf("cleartext destination must never be dialed")
	}
	if !h.monitor.has(egressDeniedCleartext) {
		t.Fatalf("expected a denied_cleartext flag, got %v", h.monitor.decisions())
	}
}

func TestEgress_NonTLSPortIsRefusedWhenRequireTLS(t *testing.T) {
	cfg := baseCfg()
	cfg.policy = egressPolicy{allowlist: []string{"registry.npmjs.org"}}
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "registry.npmjs.org:22")
	defer conn.Close()
	if status != 403 {
		t.Fatalf("CONNECT to :22 under require-TLS got %d, want 403", status)
	}
}

// ---- Rung 3 cross-check: SNI must match the authorised authority ----

func TestEgress_SNIMismatchIsRefusedBeforeDial(t *testing.T) {
	cfg := baseCfg()
	cfg.sniCrossCheck = true
	// `allowed.example` is on the list; `attacker.example` is not. A client
	// that CONNECTs to the allowed authority but negotiates TLS with the
	// attacker SNI (domain-fronting) must be refused, and the destination never
	// dialed.
	cfg.policy = egressPolicy{allowlist: []string{"allowed.example"}}
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "allowed.example:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("authority passed the list but CONNECT got %d, want 200", status)
	}
	// Drive a real ClientHello carrying the mismatched SNI.
	tlsConn := tls.Client(conn, &tls.Config{
		ServerName:         "attacker.example",
		InsecureSkipVerify: true,
	})
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	if err := tlsConn.Handshake(); err == nil {
		t.Fatalf("handshake unexpectedly succeeded; adapter should have refused the SNI mismatch")
	}
	if h.dialer.dialedAuthority("allowed.example:443") {
		t.Fatalf("SNI mismatch must be refused BEFORE dialing the destination")
	}
	if !h.monitor.has(egressDeniedSNIMismatch) {
		t.Fatalf("expected a denied_sni_mismatch flag, got %v", h.monitor.decisions())
	}
}

// ---- Rung 1b: per-destination throttle, keyed per host ----

func TestEgressThrottle_ConnectionBurstTarpitsOneHostOnly(t *testing.T) {
	cfg := throttleConfig{
		connWindow:          time.Second,
		maxConnsPerWindow:   3,
		tarpitPerExcessConn: 100 * time.Millisecond,
		maxTarpit:           time.Second,
		byteBurst:           1 << 20,
		bytesPerSec:         1 << 20,
	}
	th := newEgressThrottle(cfg)

	// First 3 connections to host A are under budget.
	for i := 0; i < 3; i++ {
		if d, throttled := th.admitConnection("a.example"); throttled || d != 0 {
			t.Fatalf("conn %d to A should be under budget, got throttled=%v delay=%v", i, throttled, d)
		}
	}
	// The 4th trips the throttle with a tar-pit delay.
	d, throttled := th.admitConnection("a.example")
	if !throttled || d <= 0 {
		t.Fatalf("burst to A should be throttled, got throttled=%v delay=%v", throttled, d)
	}
	// A different host is unaffected — the throttle is per destination.
	if d, throttled := th.admitConnection("b.example"); throttled || d != 0 {
		t.Fatalf("host B must not be slowed by host A's burst, got throttled=%v delay=%v", throttled, d)
	}
}

func TestEgressThrottle_ByteVolumeThrottlesOneHostNotAnother(t *testing.T) {
	cfg := throttleConfig{
		connWindow:        time.Minute,
		maxConnsPerWindow: 1000,
		byteBurst:         1 << 10,   // 1 KiB flows free, then the cap engages
		bytesPerSec:       256 << 10, // fast enough to drain in the test window
	}
	th := newEgressThrottle(cfg)
	limA := th.limiterFor("a.example")
	limB := th.limiterFor("b.example")

	// Stream well over the burst to host A: the copy must report throttling.
	payload := bytes.Repeat([]byte("x"), 8<<10) // 8 KiB
	var sink bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, throttledA, err := throttledCopy(ctx, &sink, bytes.NewReader(payload), limA)
	if err != nil {
		t.Fatalf("copy to A: %v", err)
	}
	if !throttledA {
		t.Fatalf("a large volume to A should have been throttled")
	}

	// A small flow to B stays under B's own burst — not slowed.
	var sinkB bytes.Buffer
	small := bytes.Repeat([]byte("y"), 512)
	_, throttledB, err := throttledCopy(ctx, &sinkB, bytes.NewReader(small), limB)
	if err != nil {
		t.Fatalf("copy to B: %v", err)
	}
	if throttledB {
		t.Fatalf("a small flow to B must not be throttled by A's volume")
	}
}
