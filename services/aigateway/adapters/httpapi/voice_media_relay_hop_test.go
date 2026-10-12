package httpapi

// The cross-pod hop of the Twilio media relay (langwatch#8397).
// Twilio dials the gateway through an L4 load balancer, so its socket can land
// on a pod that does not hold the relay. That pod dials the owner's hop
// listener, claims the relay there, and pumps Twilio's frames over the hop.
//
// Two gateway pods run in one process. Pod A is 127.0.0.2 and pod B is
// 127.0.0.3: both are loopback on Linux, and each pod's hop listener binds its
// own address on the same port, as the pods of one deployment share a port.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
)

const (
	hopPodA  = "127.0.0.2"
	hopPodB  = "127.0.0.3"
	hopBootA = "boot-a"
	hopBootB = "boot-b"
	hopPath  = "/relay-hop/"

	// hopIDKey is a gateway-only id key: 40 bytes, over the 32 byte floor.
	hopIDKey = "gateway-only-relay-id-key-with-40-bytes!"

	hopOutcomeJoined      = "hop_joined"
	hopOutcomeUnreachable = "refused_owner_unreachable"
	hopOutcomeInvalid     = "refused_owner_invalid"
	hopOutcomeBusy        = "refused_hop_busy"
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// mrHopPod is one gateway pod: the public router of newMRGateway, a hub that
// knows its pod address and boot id, and (when it has a listener) the hop
// router on the pod's own address.
type mrHopPod struct {
	*mrGateway
	ip   string
	logs *observer.ObservedLogs
	hop  net.Listener
}

type mrHopSpec struct {
	ip, boot string
	// dialPort is the hop port this pod dials owners on.
	dialPort int
	// listener, when set, is this pod's hop listener and is served.
	listener net.Listener
	// hub tunes the hub options after the defaults below.
	hub func(*mediarelay.Options)
}

func newHopPod(t *testing.T, spec mrHopSpec) *mrHopPod {
	t.Helper()
	core, logs := observer.New(zap.DebugLevel)
	logger := zap.New(core)
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) {
		o.PodIP, o.BootID = spec.ip, spec.boot
		o.HopPort = spec.dialPort
		o.HopTimeout = 2 * time.Second
		o.Logger = logger
		if spec.hub != nil {
			spec.hub(o)
		}
	}))
	pod := &mrHopPod{mrGateway: g, ip: spec.ip, logs: logs, hop: spec.listener}
	if spec.listener != nil {
		router := NewHopRouter(HopRouterDeps{Logger: logger, InternalSecret: mrSecret, MediaRelay: g.hub})
		srv := &http.Server{
			// The access log reads its logger from the request context.
			Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				router.ServeHTTP(w, r.WithContext(clog.Set(r.Context(), logger)))
			}),
			ReadHeaderTimeout: 5 * time.Second,
		}
		go func() { _ = srv.Serve(spec.listener) }()
		t.Cleanup(func() { _ = srv.Close() })
	}
	return pod
}

// listenHopPair binds one hop listener per pod address, on one shared port.
func listenHopPair(t *testing.T) (a, b net.Listener, port int) {
	t.Helper()
	for range 20 {
		la, err := net.Listen("tcp", net.JoinHostPort(hopPodA, "0"))
		require.NoError(t, err, "the test needs 127.0.0.0/8 to be loopback, as it is on Linux")
		port = la.Addr().(*net.TCPAddr).Port
		lb, err := net.Listen("tcp", net.JoinHostPort(hopPodB, strconv.Itoa(port)))
		if err == nil {
			t.Cleanup(func() { _ = la.Close(); _ = lb.Close() })
			return la, lb, port
		}
		_ = la.Close()
	}
	t.Fatal("no port was free on both pod addresses")
	return nil, nil, 0
}

// newHopPair is pod A and pod B, each serving its hop listener. hub tunes
// both hubs.
func newHopPair(t *testing.T, hub func(*mediarelay.Options)) (a, b *mrHopPod) {
	t.Helper()
	la, lb, port := listenHopPair(t)
	a = newHopPod(t, mrHopSpec{ip: hopPodA, boot: hopBootA, dialPort: port, listener: la, hub: hub})
	b = newHopPod(t, mrHopSpec{ip: hopPodB, boot: hopBootB, dialPort: port, listener: lb, hub: hub})
	return a, b
}

// listenOn binds ip on a free port and answers the listener and the port.
func listenOn(t *testing.T, ip string) (net.Listener, int) {
	t.Helper()
	l, err := net.Listen("tcp", net.JoinHostPort(ip, "0"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = l.Close() })
	return l, l.Addr().(*net.TCPAddr).Port
}

// closedHopPort is a port nothing listens on.
func closedHopPort(t *testing.T) int {
	t.Helper()
	l, port := listenOn(t, hopPodA)
	require.NoError(t, l.Close())
	return port
}

// mrBlackhole accepts TCP connections and never answers on them.
type mrBlackhole struct {
	port     int
	accepted atomic.Int64
	mu       sync.Mutex
	conns    []net.Conn
}

// newBlackhole listens on ip (empty means every address).
func newBlackhole(t *testing.T, ip string) *mrBlackhole {
	t.Helper()
	address := ":0"
	if ip != "" {
		address = net.JoinHostPort(ip, "0")
	}
	//nolint:gosec // G102: an empty ip is the wildcard bind this trap exists to cover.
	l, err := net.Listen("tcp", address)
	require.NoError(t, err)
	bh := &mrBlackhole{port: l.Addr().(*net.TCPAddr).Port}
	go func() {
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			bh.accepted.Add(1)
			bh.mu.Lock()
			bh.conns = append(bh.conns, conn)
			bh.mu.Unlock()
		}
	}()
	t.Cleanup(func() {
		_ = l.Close()
		bh.mu.Lock()
		defer bh.mu.Unlock()
		for _, conn := range bh.conns {
			_ = conn.Close()
		}
	})
	return bh
}

func (bh *mrBlackhole) waitForAccepted(t *testing.T, want int64) {
	t.Helper()
	require.Eventually(t, func() bool { return bh.accepted.Load() >= want }, 2*time.Second, 5*time.Millisecond,
		"the hop never dialed the owner")
}

// sealID seals claims with key.
func sealID(t *testing.T, key string, claims mediarelay.IDClaims) string {
	t.Helper()
	id, err := mediarelay.NewIDCodec(key).Seal(claims)
	require.NoError(t, err)
	return id
}

// ownerID is an id that names owner ip and boot, which no relay holds.
func ownerID(t *testing.T, ip, boot string) string {
	t.Helper()
	return sealID(t, mrSecret, mediarelay.IDClaims{
		OwnerPodIP: ip, OwnerBootID: boot, ExpiresAt: time.Now().Add(time.Minute),
	})
}

// withBoot is the id of a pending relay, claiming that its owner booted as boot.
func withBoot(t *testing.T, key, id, boot string) string {
	t.Helper()
	claims, err := mediarelay.NewIDCodec(key).Unseal(id, time.Now())
	require.NoError(t, err)
	claims.OwnerBootID = boot
	return sealID(t, key, claims)
}

func hopSigned(id string) http.Header {
	return signedHeader(mrSecret, hopPath+id, 0)
}

// dialHop upgrades on the pod's hop listener, as another pod would.
func (p *mrHopPod) dialHop(id string, header http.Header) (*websocket.Conn, *http.Response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, "http://"+p.hop.Addr().String()+hopPath+id,
		&websocket.DialOptions{HTTPHeader: header})
	if conn != nil {
		p.t.Cleanup(func() { _ = conn.CloseNow() })
	}
	return conn, resp, err
}

func (p *mrHopPod) logText() string {
	var text strings.Builder
	entries := p.logs.All()
	for i := range entries {
		fmt.Fprint(&text, entries[i].Message, " ", entries[i].ContextMap(), "\n")
	}
	return text.String()
}

func (p *mrHopPod) logged(message string) bool {
	entries := p.logs.All()
	for i := range entries {
		if entries[i].Message == message {
			return true
		}
	}
	return false
}

// requireOutcome waits for gateway_voice_media_relay_total{outcome} to be want.
func (g *mrGateway) requireOutcome(outcome string, want float64) {
	g.t.Helper()
	require.Eventually(g.t, func() bool { return g.outcomes()[outcome] == want }, 2*time.Second, 10*time.Millisecond,
		"outcome %s never reached %v: %v", outcome, want, g.outcomes())
}

// hopFrame is frame i of a stream tagged from: text and binary alternate, and
// the tag is in every frame, so a frame that crosses streams is seen.
func hopFrame(from string, i int) (websocket.MessageType, []byte) {
	if i%2 == 0 {
		return websocket.MessageText, fmt.Appendf(nil, "%s:%d", from, i)
	}
	return websocket.MessageBinary, append(fmt.Appendf(nil, "%s:", from), byte(i), 0xff, 0x00)
}

// streamFrames writes n tagged frames and answers the first write error.
func streamFrames(conn *websocket.Conn, from string, n int) error {
	for i := range n {
		kind, data := hopFrame(from, i)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := conn.Write(ctx, kind, data)
		cancel()
		if err != nil {
			return err
		}
	}
	return nil
}

// expectStream asserts the next n frames are the stream tagged from, in order.
func expectStream(t *testing.T, in *mrInbox, from string, n int) {
	t.Helper()
	for i := range n {
		kind, want := hopFrame(from, i)
		frame := in.next(t, 5*time.Second)
		require.NoError(t, frame.err, "frame %d of %s", i, from)
		require.Equal(t, kind, frame.kind, "frame %d of %s", i, from)
		require.Equal(t, want, frame.data, "frame %d of %s", i, from)
	}
}

// ---------------------------------------------------------------------------
// AC6: frames are routed to the right pair
// ---------------------------------------------------------------------------

// @scenario "Two concurrent relays on two pods are each joined to the right Twilio socket"
func TestTwoRelaysCrossingPodsEachGetOnlyTheirOwnFrames(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	r1, ready1 := a.open() // R1 is held by A
	r2, ready2 := b.open() // R2 is held by B
	t1 := b.join(ready1.RelayID)
	t2 := a.join(ready2.RelayID)
	inR1, inR2, inT1, inT2 := inbox(r1), inbox(r2), inbox(t1), inbox(t2)

	const frames = 100
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for _, writer := range []struct {
		conn *websocket.Conn
		from string
	}{{r1, "r1"}, {t1, "t1"}, {r2, "r2"}, {t2, "t2"}} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- streamFrames(writer.conn, writer.from, frames)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	t.Run("R1 receives exactly T1's frames", func(t *testing.T) { expectStream(t, inR1, "t1", frames) })
	t.Run("R2 receives exactly T2's frames", func(t *testing.T) { expectStream(t, inR2, "t2", frames) })
	t.Run("T1 receives exactly R1's frames", func(t *testing.T) { expectStream(t, inT1, "r1", frames) })
	t.Run("T2 receives exactly R2's frames", func(t *testing.T) { expectStream(t, inT2, "r2", frames) })
}

// @scenario "A hop is counted on both pods"
func TestHopIsCountedOnTheRequestingPodAndTheOwner(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	send(t, twilio, websocket.MessageText, []byte("through-the-hop"))
	expectFrame(t, inbox(relay), websocket.MessageText, []byte("through-the-hop"))

	t.Run("the pod Twilio landed on counts hop_joined", func(t *testing.T) {
		b.requireOutcome(hopOutcomeJoined, 1)
	})
	t.Run("the pod Twilio landed on does not count a pairing", func(t *testing.T) {
		assert.Zero(t, b.outcomes()["paired"])
	})
	t.Run("the owner counts paired", func(t *testing.T) {
		a.requireOutcome("paired", 1)
	})
	t.Run("the owner does not count hop_joined", func(t *testing.T) {
		assert.Zero(t, a.outcomes()[hopOutcomeJoined])
	})
}

// ---------------------------------------------------------------------------
// Closes pass through the hop
// ---------------------------------------------------------------------------

// @scenario "Twilio closing the stream ends the hopped relay with 1000"
func TestTwilioClosingAHoppedStreamEndsTheRelayWith1000(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromRelay := inbox(relay)

	require.NoError(t, twilio.Close(websocket.StatusNormalClosure, ""))

	code, _ := fromRelay.ended(t, 3*time.Second)
	assert.Equal(t, websocket.StatusNormalClosure, code)
}

// @scenario "The worker closing a hopped relay closes Twilio's socket with 1000"
func TestWorkerClosingAHoppedRelayClosesTwilioWith1000(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromTwilio := inbox(twilio)

	require.NoError(t, relay.Close(websocket.StatusNormalClosure, ""))

	code, _ := fromTwilio.ended(t, 3*time.Second)
	assert.Equal(t, websocket.StatusNormalClosure, code)
}

// @scenario "Twilio dropping a hopped stream ends the relay with 4502"
func TestTwilioDroppingAHoppedStreamEndsTheRelayWith4502(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromRelay := inbox(relay)

	require.NoError(t, twilio.CloseNow())

	code, _ := fromRelay.ended(t, 3*time.Second)
	assert.Equal(t, mrClosePeerLost, code)
}

// @scenario "A hopped relay older than its maximum duration is closed with 4409"
func TestHoppedRelayOlderThanItsMaximumDurationIsClosedWith4409(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, func(o *mediarelay.Options) { o.MaxRelayDuration = 400 * time.Millisecond })
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)

	relayCode, _ := fromRelay.ended(t, 3*time.Second)
	twilioCode, _ := fromTwilio.ended(t, 3*time.Second)

	t.Run("the relay is closed with 4409", func(t *testing.T) {
		assert.Equal(t, mrCloseMaxDuration, relayCode)
	})
	t.Run("Twilio's socket is closed with 1000", func(t *testing.T) {
		assert.Equal(t, websocket.StatusNormalClosure, twilioCode)
	})
}

// ---------------------------------------------------------------------------
// The owner refuses
// ---------------------------------------------------------------------------

// @scenario "An owner that refuses the hop refuses Twilio"
func TestOwnerRefusalIsAnsweredToTwilioAs403(t *testing.T) {
	t.Parallel()
	for name, prepare := range map[string]func(t *testing.T, a, b *mrHopPod) string{
		"an id already joined once": func(_ *testing.T, a, _ *mrHopPod) string {
			_, _, id := a.pair()
			return id
		},
		"an id the owner never opened": func(t *testing.T, _, _ *mrHopPod) string {
			t.Helper()
			return ownerID(t, hopPodA, hopBootA)
		},
		"an id whose relay has ended": func(t *testing.T, a, _ *mrHopPod) string {
			t.Helper()
			relay, ready := a.open()
			require.NoError(t, relay.Close(websocket.StatusNormalClosure, ""))
			a.waitForNoRelays()
			return ready.RelayID
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			a, b := newHopPair(t, nil)
			id := prepare(t, a, b)
			started := time.Now()

			conn, resp, err := b.dialTwilio(id)

			assert.Nil(t, conn)
			refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
			assert.Less(t, time.Since(started), time.Second, "an owner's 403 is answered at once, not after the hop timeout")
		})
	}
}

// @scenario "A replayed id on another pod leaves the joined pair running"
func TestReplayOnAnotherPodLeavesTheJoinedPairRunning(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, twilio, id := a.pair()
	_, resp, err := b.dialTwilio(id)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)

	send(t, twilio, websocket.MessageText, []byte("still-joined"))

	expectFrame(t, inbox(relay), websocket.MessageText, []byte("still-joined"))
}

// ---------------------------------------------------------------------------
// AC7a, AC7b: an owner that cannot be reached
// ---------------------------------------------------------------------------

// @scenario "A hop to an owner with a closed port refuses Twilio quickly"
func TestHopToAnOwnerWithAClosedPortRefusesTwilioQuickly(t *testing.T) {
	t.Parallel()
	b := newHopPod(t, mrHopSpec{ip: hopPodB, boot: hopBootB, dialPort: closedHopPort(t)})
	id := ownerID(t, hopPodA, hopBootA)
	started := time.Now()

	conn, resp, err := b.dialTwilio(id)
	elapsed := time.Since(started)

	t.Run("Twilio gets 403 and no socket", func(t *testing.T) {
		assert.Nil(t, conn)
		refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	})
	t.Run("the answer comes within a second", func(t *testing.T) {
		assert.Less(t, elapsed, time.Second)
	})
	t.Run("relay_owner_unreachable is logged", func(t *testing.T) {
		assert.True(t, b.logged("relay_owner_unreachable"), b.logText())
	})
	t.Run("refused_owner_unreachable is counted", func(t *testing.T) {
		b.requireOutcome(hopOutcomeUnreachable, 1)
	})
	t.Run("the log does not hold the full relay id", func(t *testing.T) {
		assert.NotContains(t, b.logText(), id[:16])
	})
}

// @scenario "A hop to an owner that never answers refuses Twilio within the hop timeout"
func TestHopToABlackholedOwnerRefusesTwilioWithinTheHopTimeout(t *testing.T) {
	t.Parallel()
	owner := newBlackhole(t, hopPodA)
	b := newHopPod(t, mrHopSpec{
		ip: hopPodB, boot: hopBootB, dialPort: owner.port,
		hub: func(o *mediarelay.Options) { o.HopTimeout = 400 * time.Millisecond },
	})
	id := ownerID(t, hopPodA, hopBootA)
	started := time.Now()

	conn, resp, err := b.dialTwilio(id)
	elapsed := time.Since(started)

	t.Run("Twilio gets 403 and no socket", func(t *testing.T) {
		assert.Nil(t, conn)
		refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	})
	t.Run("the owner was dialed", func(t *testing.T) {
		assert.EqualValues(t, 1, owner.accepted.Load())
	})
	t.Run("the answer waits for the hop timeout", func(t *testing.T) {
		assert.GreaterOrEqual(t, elapsed, 300*time.Millisecond)
	})
	t.Run("the answer comes soon after the hop timeout", func(t *testing.T) {
		assert.Less(t, elapsed, 2*time.Second)
	})
	t.Run("relay_owner_unreachable is logged", func(t *testing.T) {
		assert.True(t, b.logged("relay_owner_unreachable"), b.logText())
	})
	t.Run("refused_owner_unreachable is counted", func(t *testing.T) {
		b.requireOutcome(hopOutcomeUnreachable, 1)
	})
	t.Run("the abandoned dial is closed", func(t *testing.T) {
		owner.mu.Lock()
		conn := owner.conns[0]
		owner.mu.Unlock()
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
		// The owner reads the dial's own handshake request, then sees the end.
		var err error
		for err == nil {
			_, err = conn.Read(make([]byte, 512))
		}
		var netErr net.Error
		assert.False(t, errors.As(err, &netErr) && netErr.Timeout(), "the dial was left open")
	})
}

// ---------------------------------------------------------------------------
// AC7c: the hop listener authenticates and checks the boot id
// ---------------------------------------------------------------------------

// @scenario "A hop request without a valid signature is refused with 401"
func TestHopRequestWithoutAValidSignatureIsRefused(t *testing.T) {
	t.Parallel()
	l, port := listenOn(t, hopPodA)
	a := newHopPod(t, mrHopSpec{ip: hopPodA, boot: hopBootA, dialPort: port, listener: l})
	relay, ready := a.open()
	id := ready.RelayID

	for name, tc := range map[string]struct {
		header http.Header
		code   string
	}{
		"no signature headers":                  {nil, "missing_signature"},
		"a bad signature":                       {signedHeader("not-the-secret", hopPath+id, 0), "invalid_signature"},
		"a signature 301 seconds old":           {signedHeader(mrSecret, hopPath+id, 301*time.Second), "timestamp_out_of_window"},
		"a signature over another relay's path": {signedHeader(mrSecret, hopPath+"another", 0), "invalid_signature"},
		"a signature over the public path":      {signedHeader(mrSecret, mrTwilioPath+id, 0), "invalid_signature"},
		"only an lwl_ bearer token":             {licensedHeader(), "missing_signature"},
	} {
		t.Run(name, func(t *testing.T) {
			conn, resp, err := a.dialHop(id, tc.header)

			assert.Nil(t, conn)
			refusedWith(t, resp, err, http.StatusUnauthorized, tc.code)
		})
	}
	t.Run("the relay is still waiting for Twilio", func(t *testing.T) {
		twilio := a.join(id)
		send(t, twilio, websocket.MessageText, []byte("after-refusals"))
		expectFrame(t, inbox(relay), websocket.MessageText, []byte("after-refusals"))
	})
}

// @scenario "A hop request that is not an upgrade, or carries a body, is refused with 400"
func TestHopRequestThatIsNoUpgradeOrCarriesABodyIsRefused(t *testing.T) {
	t.Parallel()
	l, port := listenOn(t, hopPodA)
	a := newHopPod(t, mrHopSpec{ip: hopPodA, boot: hopBootA, dialPort: port, listener: l})
	_, ready := a.open()
	url := "http://" + l.Addr().String() + hopPath + ready.RelayID

	t.Run("a plain GET", func(t *testing.T) {
		assert.Equal(t, http.StatusBadRequest, plainGet(t, url, hopSigned(ready.RelayID)))
	})
	t.Run("an upgrade with a body", func(t *testing.T) {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, strings.NewReader("body"))
		require.NoError(t, err)
		req.Header = upgradeHeader(hopSigned(ready.RelayID))

		resp, err := http.DefaultClient.Do(req)

		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	})
	t.Run("the relay is still waiting for Twilio", func(t *testing.T) {
		_ = a.join(ready.RelayID)
	})
}

// @scenario "A hop for a relay whose owner pod restarted is refused with 403"
func TestHopThroughAnotherPodForARestartedOwnerIsRefused(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	_, ready := a.open()
	stale := withBoot(t, mrSecret, ready.RelayID, "booted-before-a-restart")

	conn, resp, err := b.dialTwilio(stale)

	assert.Nil(t, conn)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
}

// @scenario "A hop for a relay whose owner pod restarted is refused with 403"
func TestHopRequestOnTheOwnersHopPortForARestartedOwnerIsRefused(t *testing.T) {
	t.Parallel()
	a, _ := newHopPair(t, nil)
	_, ready := a.open()
	stale := withBoot(t, mrSecret, ready.RelayID, "booted-before-a-restart")

	conn, resp, err := a.dialHop(stale, hopSigned(stale))

	assert.Nil(t, conn)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
}

// @scenario "A hop for a relay whose owner pod restarted is refused with 403"
func TestTwilioOnTheOwnersPublicPortForARestartedOwnerIsRefused(t *testing.T) {
	t.Parallel()
	a, _ := newHopPair(t, nil)
	_, ready := a.open()
	stale := withBoot(t, mrSecret, ready.RelayID, "booted-before-a-restart")

	conn, resp, err := a.dialTwilio(stale)

	assert.Nil(t, conn)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
}

// @scenario "A refused stale id leaves the relay joinable with its real id"
func TestRefusedStaleIDLeavesTheRelayJoinableWithItsRealID(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	_, resp, err := b.dialTwilio(withBoot(t, mrSecret, ready.RelayID, "booted-before-a-restart"))
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)

	twilio := b.join(ready.RelayID)
	send(t, twilio, websocket.MessageText, []byte("real-id"))

	expectFrame(t, inbox(relay), websocket.MessageText, []byte("real-id"))
}

// ---------------------------------------------------------------------------
// AC7d: the hop route lives on the hop listener only
// ---------------------------------------------------------------------------

// @scenario "The public router serves no relay-hop route"
func TestPublicRouterServesNoRelayHopRoute(t *testing.T) {
	t.Parallel()
	a, _ := newHopPair(t, nil)
	_, ready := a.open()
	id := ready.RelayID

	for name, path := range map[string]string{
		"/relay-hop/{id}":    hopPath + id,
		"/v1/relay-hop/{id}": "/v1/relay-hop/" + id,
	} {
		t.Run(name, func(t *testing.T) {
			conn, resp, err := a.dial(path, &websocket.DialOptions{HTTPHeader: hopSigned(id)})

			assert.Nil(t, conn)
			refusedWith(t, resp, err, http.StatusNotFound, "")
		})
	}
	t.Run("the relay is untouched", func(t *testing.T) {
		_ = a.join(id)
	})
}

// @scenario "The hop listener serves only the hop route"
func TestHopListenerServesOnlyTheHopRoute(t *testing.T) {
	t.Parallel()
	a, _ := newHopPair(t, nil)
	_, ready := a.open()
	base := "http://" + a.hop.Addr().String()

	for name, path := range map[string]string{
		"the public Twilio route": mrTwilioPath + ready.RelayID,
		"the relay open route":    mrRelayPath,
		"the signed open route":   mrRelayPath + "/" + mrOrg,
		"the health route":        "/healthz",
		"the metrics route":       "/metrics",
		"the root":                "/",
	} {
		t.Run(name, func(t *testing.T) {
			header := upgradeHeader(hopSigned(ready.RelayID))
			header.Set("Authorization", licensedHeader().Get("Authorization"))
			req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, base+path, nil)
			require.NoError(t, err)
			req.Header = header

			resp, err := http.DefaultClient.Do(req)

			require.NoError(t, err)
			_ = resp.Body.Close()
			assert.Equal(t, http.StatusNotFound, resp.StatusCode)
		})
	}
}

// ---------------------------------------------------------------------------
// B4: only private owner addresses are dialed
// ---------------------------------------------------------------------------

// @scenario "An owner address outside the private ranges is refused without a dial"
func TestOwnerAddressOutsideThePrivateRangesIsRefusedWithoutADial(t *testing.T) {
	t.Parallel()
	// Dialing 0.0.0.0, :: or localhost reaches this wildcard listener, so a
	// dial for those owners would be seen.
	trap := newBlackhole(t, "")

	for name, owner := range map[string]string{
		"a public address":          "8.8.8.8",
		"a link-local address":      "169.254.169.254",
		"just above shared space":   "100.128.0.1",
		"the unspecified address":   "0.0.0.0",
		"the unspecified IPv6":      "::",
		"a host name":               "localhost",
		"an address with a port":    "127.0.0.2:80",
		"an address with a path":    "127.0.0.2/x",
		"an address with userinfo":  "x@127.0.0.2",
		"an address with a space":   "127.0.0.2 ",
		"an IPv4 mapped public one": "::ffff:8.8.8.8",
	} {
		t.Run(name, func(t *testing.T) {
			b := newHopPod(t, mrHopSpec{ip: hopPodB, boot: hopBootB, dialPort: trap.port})
			started := time.Now()

			conn, resp, err := b.dialTwilio(ownerID(t, owner, hopBootA))

			assert.Nil(t, conn)
			refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
			b.requireOutcome(hopOutcomeInvalid, 1)
			assert.True(t, b.logged("relay_owner_invalid"), b.logText())
			assert.Zero(t, b.outcomes()[hopOutcomeUnreachable], "an invalid owner is not an unreachable one")
			assert.Less(t, time.Since(started), time.Second)
		})
	}
	t.Run("no owner was dialed", func(t *testing.T) {
		assert.Zero(t, trap.accepted.Load())
	})
}

// ---------------------------------------------------------------------------
// B5: the gateway-only id key
// ---------------------------------------------------------------------------

// @scenario "A gateway-only key seals relay ids when it is set"
func TestRelayIDKeySealsTheIDsWhenSet(t *testing.T) {
	t.Parallel()
	a, _ := newHopPair(t, func(o *mediarelay.Options) { o.IDKey = hopIDKey })
	_, ready := a.open()

	t.Run("the id opens with the key", func(t *testing.T) {
		claims, err := mediarelay.NewIDCodec(hopIDKey).Unseal(ready.RelayID, time.Now())

		require.NoError(t, err)
		assert.Equal(t, hopPodA, claims.OwnerPodIP)
	})
	t.Run("the id does not open with the internal secret", func(t *testing.T) {
		_, err := mediarelay.NewIDCodec(mrSecret).Unseal(ready.RelayID, time.Now())

		assert.ErrorIs(t, err, mediarelay.ErrIDInvalid)
	})
}

// @scenario "Relay ids sealed with the gateway-only key hop between pods"
func TestRelayIDsSealedWithTheGatewayOnlyKeyHopBetweenPods(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, func(o *mediarelay.Options) { o.IDKey = hopIDKey })
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)

	send(t, twilio, websocket.MessageText, []byte("keyed-hop"))

	expectFrame(t, inbox(relay), websocket.MessageText, []byte("keyed-hop"))
}

// @scenario "An id sealed with the internal secret is refused when a gateway-only key is set"
func TestIDSealedWithTheInternalSecretIsRefusedWhenAKeyIsSet(t *testing.T) {
	t.Parallel()
	a, _ := newHopPair(t, func(o *mediarelay.Options) { o.IDKey = hopIDKey })
	_, ready := a.open()
	claims, err := mediarelay.NewIDCodec(hopIDKey).Unseal(ready.RelayID, time.Now())
	require.NoError(t, err)

	conn, resp, err := a.dialTwilio(sealID(t, mrSecret, claims))

	assert.Nil(t, conn)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
}

// ---------------------------------------------------------------------------
// B6: the hop dial cap
// ---------------------------------------------------------------------------

// @scenario "The hop dial cap refuses further hops without a dial"
func TestHopDialCapRefusesFurtherHopsWithoutADial(t *testing.T) {
	t.Parallel()
	owner := newBlackhole(t, hopPodA)
	b := newHopPod(t, mrHopSpec{
		ip: hopPodB, boot: hopBootB, dialPort: owner.port,
		hub: func(o *mediarelay.Options) { o.MaxHopDials = 1; o.HopTimeout = 1500 * time.Millisecond },
	})
	heldID := ownerID(t, hopPodA, hopBootA)
	first := make(chan error, 1)
	go func() {
		_, _, err := b.dialTwilio(heldID)
		first <- err
	}()
	owner.waitForAccepted(t, 1)
	started := time.Now()

	conn, resp, err := b.dialTwilio(ownerID(t, hopPodA, hopBootA))

	t.Run("the hop over the cap gets 403 and no socket", func(t *testing.T) {
		assert.Nil(t, conn)
		refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	})
	t.Run("it is refused at once", func(t *testing.T) {
		assert.Less(t, time.Since(started), time.Second)
	})
	t.Run("it dials nothing", func(t *testing.T) {
		assert.EqualValues(t, 1, owner.accepted.Load())
	})
	t.Run("refused_hop_busy is counted", func(t *testing.T) {
		b.requireOutcome(hopOutcomeBusy, 1)
	})
	t.Run("the dial that held the cap ends as an unreachable owner", func(t *testing.T) {
		require.Error(t, <-first)
		b.requireOutcome(hopOutcomeUnreachable, 1)
	})
	t.Run("the cap is free again once that dial ends", func(t *testing.T) {
		_, _, _ = b.dialTwilio(ownerID(t, hopPodA, hopBootA))

		owner.waitForAccepted(t, 2)
	})
}

// ---------------------------------------------------------------------------
// B7: a draining owner still takes a hop
// ---------------------------------------------------------------------------

// @scenario "A draining owner still accepts a hop for its pending relay"
func TestDrainingOwnerStillAcceptsAHopForItsPendingRelay(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	a.hub.BeginDrain()

	twilio := b.join(ready.RelayID)
	send(t, twilio, websocket.MessageText, []byte("hopped-while-draining"))

	expectFrame(t, inbox(relay), websocket.MessageText, []byte("hopped-while-draining"))
}

// ---------------------------------------------------------------------------
// B8: no pod address, no hop
// ---------------------------------------------------------------------------

// @scenario "A pod without an address refuses an id that names an owner"
func TestPodWithoutAnAddressRefusesAnIDThatNamesAnOwner(t *testing.T) {
	t.Parallel()
	trap := newBlackhole(t, hopPodA)
	single := newHopPod(t, mrHopSpec{ip: "", boot: "", dialPort: trap.port})
	started := time.Now()

	conn, resp, err := single.dialTwilio(ownerID(t, hopPodA, hopBootA))

	t.Run("Twilio gets 403 and no socket", func(t *testing.T) {
		assert.Nil(t, conn)
		refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	})
	t.Run("the answer is immediate", func(t *testing.T) {
		assert.Less(t, time.Since(started), time.Second)
	})
	t.Run("nothing is dialed", func(t *testing.T) {
		assert.Zero(t, trap.accepted.Load())
	})
	t.Run("refused_unknown is counted", func(t *testing.T) {
		single.requireOutcome("refused_unknown", 1)
	})
}

// @scenario "A pod without an address still serves its own ids"
func TestPodWithoutAnAddressStillJoinsItsOwnRelays(t *testing.T) {
	t.Parallel()
	single := newHopPod(t, mrHopSpec{dialPort: closedHopPort(t)})
	relay, twilio, _ := single.pair()

	send(t, twilio, websocket.MessageText, []byte("single-pod"))

	expectFrame(t, inbox(relay), websocket.MessageText, []byte("single-pod"))
}

// ---------------------------------------------------------------------------
// B9: hop outcomes are counted, with the same label rules
// ---------------------------------------------------------------------------

// @scenario "Metric labels never carry a relay id"
func TestHopOutcomeLabelsAreBoundedAndCarryNoRelayID(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	inbox(relay)
	require.NoError(t, twilio.Close(websocket.StatusNormalClosure, ""))
	b.requireOutcome(hopOutcomeJoined, 1)
	_, _, _ = b.dialTwilio(ready.RelayID)

	families, err := b.metrics.Registry().Gather()
	require.NoError(t, err)
	var labelNames, labelValues []string
	for _, family := range families {
		if family.GetName() != "gateway_voice_media_relay_total" {
			continue
		}
		for _, metric := range family.GetMetric() {
			for _, label := range metric.GetLabel() {
				labelNames = append(labelNames, label.GetName())
				labelValues = append(labelValues, label.GetValue())
			}
		}
	}

	t.Run("the only label is outcome", func(t *testing.T) {
		require.NotEmpty(t, labelNames)
		assert.Subset(t, []string{"outcome"}, labelNames)
	})
	t.Run("its values are from the fixed set, hop outcomes included", func(t *testing.T) {
		fixed := append([]string{hopOutcomeJoined, hopOutcomeUnreachable, hopOutcomeInvalid, hopOutcomeBusy}, mrOutcomes...)
		assert.Subset(t, fixed, labelValues)
	})
}

// ---------------------------------------------------------------------------
// AC9c: the hop leaks no id and no payload into logs
// ---------------------------------------------------------------------------

// @scenario "The relay id never appears in full in hop logs"
func TestRelayIDNeverAppearsInFullInHopLogs(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	id := ready.RelayID
	stale := withBoot(t, mrSecret, id, "booted-before-a-restart")
	_, resp, err := b.dialTwilio(stale)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	_, resp, err = a.dialHop(id, signedHeader("not-the-secret", hopPath+id, 0))
	refusedWith(t, resp, err, http.StatusUnauthorized, "invalid_signature")
	twilio := b.join(id)
	send(t, twilio, websocket.MessageText, []byte("hello"))
	expectFrame(t, inbox(relay), websocket.MessageText, []byte("hello"))
	_, resp, err = b.dialTwilio(id)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	require.NoError(t, relay.Close(websocket.StatusNormalClosure, ""))
	a.waitForNoRelays()

	for name, pod := range map[string]*mrHopPod{"the owner": a, "the pod Twilio landed on": b} {
		t.Run(name, func(t *testing.T) {
			logs := pod.logText()

			require.NotEmpty(t, pod.logs.All(), "nothing was logged, so the assertions below prove nothing")
			assert.NotContains(t, logs, id[:16], "more than a short prefix of the relay id is in the log")
			assert.NotContains(t, logs, stale[:16], "more than a short prefix of the refused id is in the log")
		})
	}
}

// @scenario "Frame payloads never appear in hop logs"
func TestFramePayloadsNeverAppearInHopLogs(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)
	const marker = "HOP-PAYLOAD-MARKER-5d21e8"

	send(t, relay, websocket.MessageText, []byte(`{"audio":"`+marker+`-down"}`))
	send(t, twilio, websocket.MessageBinary, []byte(marker+"-up"))
	fromTwilio.next(t, 5*time.Second)
	fromRelay.next(t, 5*time.Second)
	require.NoError(t, relay.CloseNow())
	a.waitForNoRelays()

	for name, pod := range map[string]*mrHopPod{"the owner": a, "the pod Twilio landed on": b} {
		t.Run(name, func(t *testing.T) {
			assert.NotContains(t, pod.logText(), marker)
		})
	}
}
