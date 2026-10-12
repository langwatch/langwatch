package httpapi

// How the cross-pod hop of the Twilio media relay ends and what it refuses to
// follow (langwatch#8397): redirects, line breaks in ids, a client that gives
// up mid-dial, sockets that outlive their peer, the drain, and the close
// codes that cross the hop. It reuses the two-pod fixtures of
// voice_media_relay_hop_test.go; a scripted owner stands in for pod A where
// the test needs control over what the owner sends.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
)

// hopOutcomeDrainedUnpaired is the outcome of a relay that was still waiting
// for Twilio when the drain budget ran out.
const hopOutcomeDrainedUnpaired = "drained_unpaired"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// mrFakeOwner is a hop listener on ip whose handler the test scripts. It
// counts the requests it receives and keeps their headers.
type mrFakeOwner struct {
	port     int
	requests atomic.Int64
	mu       sync.Mutex
	headers  []http.Header
}

func newFakeOwner(t *testing.T, ip string, handler http.HandlerFunc) *mrFakeOwner {
	t.Helper()
	listener, port := listenOn(t, ip)
	owner := &mrFakeOwner{port: port}
	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			owner.requests.Add(1)
			owner.mu.Lock()
			owner.headers = append(owner.headers, r.Header.Clone())
			owner.mu.Unlock()
			handler(w, r)
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() { _ = srv.Serve(listener) }()
	t.Cleanup(func() { _ = srv.Close() })
	return owner
}

// sawHeader reports whether any request this owner received carried name.
func (o *mrFakeOwner) sawHeader(name string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	for _, header := range o.headers {
		if header.Get(name) != "" {
			return true
		}
	}
	return false
}

// mrHeldHop is the owner's side of one accepted hop.
type mrHeldHop struct {
	conn *websocket.Conn
	// ended closes when the hop socket fails or closes.
	ended chan struct{}
}

// holdHop accepts the hop upgrade and keeps the socket open, reading it, until
// the other side ends it. The held hop is sent on the returned channel.
func holdHop() (http.HandlerFunc, <-chan *mrHeldHop) {
	held := make(chan *mrHeldHop, 4)
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled,
		})
		if err != nil {
			return
		}
		conn.SetReadLimit(1 << 20)
		hop := &mrHeldHop{conn: conn, ended: make(chan struct{})}
		held <- hop
		for {
			if _, _, err := conn.Read(context.Background()); err != nil {
				close(hop.ended)
				return
			}
		}
	}, held
}

func awaitHeldHop(t *testing.T, held <-chan *mrHeldHop) *mrHeldHop {
	t.Helper()
	select {
	case hop := <-held:
		t.Cleanup(func() { _ = hop.conn.CloseNow() })
		return hop
	case <-time.After(5 * time.Second):
		t.Fatal("the owner never accepted a hop")
		return nil
	}
}

func requireEnds(t *testing.T, ended <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ended:
	case <-time.After(3 * time.Second):
		t.Fatalf("%s stayed open", what)
	}
}

// loggedOutcomes lists the outcome field of every voice_media_relay_ended entry.
func (p *mrHopPod) loggedOutcomes() []any {
	var outcomes []any
	entries := p.logs.All()
	for i := range entries {
		if entries[i].Message == "voice_media_relay_ended" {
			outcomes = append(outcomes, entries[i].ContextMap()["outcome"])
		}
	}
	return outcomes
}

// podHoppingTo is pod B with its hop dial aimed at owner's port.
func podHoppingTo(t *testing.T, owner *mrFakeOwner, hub func(*mediarelay.Options)) *mrHopPod {
	t.Helper()
	return newHopPod(t, mrHopSpec{ip: hopPodB, boot: hopBootB, dialPort: owner.port, hub: hub})
}

// ---------------------------------------------------------------------------
// The hop client follows no redirect and uses no proxy
// ---------------------------------------------------------------------------

// The owner address is private, but whatever answers on it is not trusted to
// choose where the signed request goes next. The no-proxy half is asserted on
// the transport in mediarelay's hop_test.go: Go never proxies a loopback
// address, so an HTTP_PROXY test against these loopback owners could not fail.
//
// @scenario "A hop owner that answers with a redirect refuses Twilio"
func TestOwnerRedirectIsNotFollowed(t *testing.T) {
	t.Parallel()
	var targetRequests atomic.Int64
	target := newFakeOwner(t, "127.0.0.9", func(w http.ResponseWriter, _ *http.Request) {
		targetRequests.Add(1)
		w.WriteHeader(http.StatusForbidden)
	})
	owner := newFakeOwner(t, hopPodA, func(w http.ResponseWriter, r *http.Request) {
		//nolint:gosec // G710: the redirect is the attack this test aims at the gateway.
		http.Redirect(w, r, "http://127.0.0.9:"+strconv.Itoa(target.port)+r.URL.Path, http.StatusTemporaryRedirect)
	})
	b := podHoppingTo(t, owner, nil)

	conn, resp, err := b.dialTwilio(ownerID(t, hopPodA, hopBootA))

	t.Run("Twilio gets 403 and no socket", func(t *testing.T) {
		assert.Nil(t, conn)
		refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	})
	t.Run("the owner was asked once", func(t *testing.T) {
		assert.EqualValues(t, 1, owner.requests.Load())
	})
	t.Run("the redirect target is never requested", func(t *testing.T) {
		assert.Zero(t, targetRequests.Load())
	})
	t.Run("the signature headers never reach the redirect target", func(t *testing.T) {
		assert.False(t, target.sawHeader("X-LangWatch-Gateway-Signature"))
	})
}

// ---------------------------------------------------------------------------
// A relay id with a line break in it
// ---------------------------------------------------------------------------

// Go's base64 decoder skips CR and LF, so a genuine id with one inserted would
// otherwise open. The id is refused as unknown, before any dial.
//
// @scenario "A relay id with a line break inserted is refused without a dial"
func TestRelayIDWithALineBreakInsertedIsRefusedWithoutADial(t *testing.T) {
	t.Parallel()
	trap := newBlackhole(t, hopPodA)
	genuine := ownerID(t, hopPodA, hopBootA)
	middle := len(genuine) / 2
	forged := map[string]string{
		"a newline":                  genuine[:middle] + "%0A" + genuine[middle:],
		"a carriage return":          genuine[:middle] + "%0D" + genuine[middle:],
		"a carriage return and feed": genuine[:middle] + "%0D%0A" + genuine[middle:],
		"a trailing newline":         genuine + "%0A",
	}
	b := newHopPod(t, mrHopSpec{ip: hopPodB, boot: hopBootB, dialPort: trap.port})

	for name, id := range forged {
		t.Run(name+" is refused with 403", func(t *testing.T) {
			conn, resp, err := b.dialTwilio(id)

			assert.Nil(t, conn)
			refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
		})
	}
	t.Run("each is counted as an unknown id", func(t *testing.T) {
		b.requireOutcome("refused_unknown", float64(len(forged)))
	})
	t.Run("none is counted as an unreachable owner", func(t *testing.T) {
		assert.Zero(t, b.outcomes()[hopOutcomeUnreachable])
	})
	t.Run("no owner is dialed", func(t *testing.T) {
		assert.Zero(t, trap.accepted.Load())
	})
}

// ---------------------------------------------------------------------------
// Twilio giving up during the hop dial
// ---------------------------------------------------------------------------

// A Twilio request that is cancelled while the pod dials the owner is Twilio's
// doing, not the owner's. It is not logged as relay_owner_unreachable and not
// counted at all: refused_owner_unreachable stays a count of owners that failed.
//
// @scenario "Twilio giving up during the hop dial is not counted as an unreachable owner"
func TestTwilioGivingUpDuringTheHopDialIsNotAnUnreachableOwner(t *testing.T) {
	t.Parallel()
	owner := newBlackhole(t, hopPodA)
	b := newHopPod(t, mrHopSpec{
		ip: hopPodB, boot: hopBootB, dialPort: owner.port,
		hub: func(o *mediarelay.Options) { o.HopTimeout = 10 * time.Second; o.MaxHopDials = 1 },
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	dialed := make(chan error, 1)
	firstURL := b.server.URL + mrTwilioPath + ownerID(t, hopPodA, hopBootA)
	go func() {
		_, _, err := websocket.Dial(ctx, firstURL, nil)
		dialed <- err
	}()
	owner.waitForAccepted(t, 1)

	cancel()

	require.Error(t, <-dialed)
	owner.mu.Lock()
	conn := owner.conns[0]
	owner.mu.Unlock()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
	var readErr error
	for readErr == nil {
		_, readErr = conn.Read(make([]byte, 512))
	}
	t.Run("relay_owner_unreachable is not logged", func(t *testing.T) {
		assert.Never(t, func() bool { return b.logged("relay_owner_unreachable") }, 500*time.Millisecond, 10*time.Millisecond)
	})
	t.Run("refused_owner_unreachable is not counted", func(t *testing.T) {
		assert.Never(t, func() bool { return b.outcomes()[hopOutcomeUnreachable] > 0 }, 500*time.Millisecond, 10*time.Millisecond)
	})
	t.Run("the dial slot is given back", func(t *testing.T) {
		// With a cap of one, a second hop is refused as busy unless the slot is free.
		second, stop := context.WithCancel(context.Background())
		defer stop()
		secondURL := b.server.URL + mrTwilioPath + ownerID(t, hopPodA, hopBootA)
		go func() {
			_, _, _ = websocket.Dial(second, secondURL, nil)
		}()

		owner.waitForAccepted(t, 2)
		assert.Zero(t, b.outcomes()[hopOutcomeBusy])
	})
}

// ---------------------------------------------------------------------------
// The hop pump has a lifecycle
// ---------------------------------------------------------------------------

// The pod Twilio reached holds the hopped socket, so it is that pod's drain
// that has to wait for it and, when the budget ends, close it with 1012.
//
// @scenario "A drain on the pod Twilio reached waits for the hop and closes it with 1012"
func TestDrainOnThePodTwilioReachedWaitsForTheHopAndClosesItWith1012(t *testing.T) {
	t.Parallel()
	const budget = 700 * time.Millisecond
	a, b := newHopPair(t, func(o *mediarelay.Options) { o.DrainBudget = budget })
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromTwilio, fromRelay := inbox(twilio), inbox(relay)
	send(t, twilio, websocket.MessageText, []byte("before-the-drain"))
	expectFrame(t, fromRelay, websocket.MessageText, []byte("before-the-drain"))

	started := time.Now()
	stopped := make(chan error, 1)
	var stoppedAfter atomic.Int64
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err := b.hub.Stop(ctx)
		stoppedAfter.Store(int64(time.Since(started)))
		stopped <- err
	}()

	code, _ := fromTwilio.ended(t, 3*time.Second)

	t.Run("Twilio's socket is closed with 1012", func(t *testing.T) {
		assert.Equal(t, mrCloseDrain, code)
	})
	t.Run("Stop returns without an error", func(t *testing.T) {
		select {
		case err := <-stopped:
			require.NoError(t, err)
		case <-time.After(3 * time.Second):
			t.Fatal("Stop did not return after the drain budget")
		}
	})
	t.Run("Stop waited for the hop through the budget", func(t *testing.T) {
		assert.GreaterOrEqual(t, time.Duration(stoppedAfter.Load()), budget-200*time.Millisecond)
	})
}

// A hopped socket cannot outlive the relay maximum even when the owner never
// ends it: the pump has its own bound, a small margin past MaxRelayDuration.
//
// @scenario "A hopped socket is bounded by the maximum relay duration"
func TestHoppedSocketIsBoundedByTheMaximumRelayDurationWhenTheOwnerNeverEndsIt(t *testing.T) {
	t.Parallel()
	handler, held := holdHop()
	owner := newFakeOwner(t, hopPodA, handler)
	b := podHoppingTo(t, owner, func(o *mediarelay.Options) { o.MaxRelayDuration = 300 * time.Millisecond })
	twilio := b.join(ownerID(t, hopPodA, hopBootA))
	hop := awaitHeldHop(t, held)
	fromTwilio := inbox(twilio)

	t.Run("Twilio's socket is closed", func(t *testing.T) {
		fromTwilio.ended(t, 3*time.Second)
	})
	t.Run("the owner's hop socket is closed", func(t *testing.T) {
		requireEnds(t, hop.ended, "the hop socket")
	})
}

// A side never stays open after its peer is gone.
//
// @scenario "A hopped Twilio socket is closed when the owner vanishes"
func TestOwnerVanishingClosesTheHoppedTwilioSocket(t *testing.T) {
	t.Parallel()
	handler, held := holdHop()
	owner := newFakeOwner(t, hopPodA, handler)
	b := podHoppingTo(t, owner, nil)
	twilio := b.join(ownerID(t, hopPodA, hopBootA))
	hop := awaitHeldHop(t, held)
	fromTwilio := inbox(twilio)

	require.NoError(t, hop.conn.CloseNow())

	fromTwilio.ended(t, 3*time.Second)
}

// @scenario "A hopped owner socket is closed when Twilio vanishes"
func TestTwilioVanishingClosesTheHopSocketToTheOwner(t *testing.T) {
	t.Parallel()
	handler, held := holdHop()
	owner := newFakeOwner(t, hopPodA, handler)
	b := podHoppingTo(t, owner, nil)
	twilio := b.join(ownerID(t, hopPodA, hopBootA))
	hop := awaitHeldHop(t, held)

	require.NoError(t, twilio.CloseNow())

	requireEnds(t, hop.ended, "the hop socket")
}

// ---------------------------------------------------------------------------
// A pending relay that ends in the drain has an outcome
// ---------------------------------------------------------------------------

// @scenario "A relay waiting for Twilio that ends in the drain is counted as drained_unpaired"
func TestPendingRelayEndingInTheDrainIsCountedAsDrainedUnpaired(t *testing.T) {
	t.Parallel()
	pod := newHopPod(t, mrHopSpec{
		ip: hopPodA, boot: hopBootA, dialPort: closedHopPort(t),
		hub: func(o *mediarelay.Options) { o.DrainBudget = 300 * time.Millisecond },
	})
	relay, _ := pod.open()
	fromRelay := inbox(relay)

	pod.hub.BeginDrain()
	code, _ := fromRelay.ended(t, 3*time.Second)
	pod.waitForNoRelays()

	t.Run("the worker is closed with 1012", func(t *testing.T) {
		assert.Equal(t, mrCloseDrain, code)
	})
	t.Run("drained_unpaired is counted once", func(t *testing.T) {
		pod.requireOutcome(hopOutcomeDrainedUnpaired, 1)
	})
	t.Run("the ended log names drained_unpaired", func(t *testing.T) {
		assert.Equal(t, []any{hopOutcomeDrainedUnpaired}, pod.loggedOutcomes())
	})
	t.Run("no other outcome is counted for the end", func(t *testing.T) {
		counts := pod.outcomes()
		delete(counts, "opened")
		delete(counts, hopOutcomeDrainedUnpaired)
		for outcome, count := range counts {
			assert.Zero(t, count, outcome)
		}
	})
}

// ---------------------------------------------------------------------------
// Close codes that cross the hop
// ---------------------------------------------------------------------------

// @scenario "An owner whose drain budget ends closes the hopped relay with 1012"
func TestOwnerDrainBudgetEndingClosesTheHoppedRelayWith1012(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, func(o *mediarelay.Options) { o.DrainBudget = 400 * time.Millisecond })
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)

	a.hub.BeginDrain()
	relayCode, relayReason := fromRelay.ended(t, 3*time.Second)
	twilioCode, _ := fromTwilio.ended(t, 3*time.Second)

	t.Run("the relay is closed with 1012", func(t *testing.T) {
		assert.Equal(t, mrCloseDrain, relayCode)
	})
	t.Run("the relay is told relay_drain", func(t *testing.T) {
		assert.Equal(t, "relay_drain", relayReason)
	})
	t.Run("Twilio's socket is closed with 1000", func(t *testing.T) {
		assert.Equal(t, websocket.StatusNormalClosure, twilioCode)
	})
}

// @scenario "A frame over 64 KiB from Twilio through the hop closes Twilio's socket with 1009"
func TestOversizedFrameFromTwilioThroughTheHopClosesTwilioWith1009(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)

	send(t, twilio, websocket.MessageBinary, make([]byte, 64*1024+1))

	t.Run("Twilio's socket is closed with 1009", func(t *testing.T) {
		code, _ := fromTwilio.ended(t, 3*time.Second)
		assert.Equal(t, websocket.StatusMessageTooBig, code)
	})
	t.Run("the relay is closed with 4502, the peer it lost", func(t *testing.T) {
		code, _ := fromRelay.ended(t, 3*time.Second)
		assert.Equal(t, mrClosePeerLost, code)
	})
}

// @scenario "A frame over 64 KiB from the worker through the hop closes the relay with 1009"
func TestOversizedFrameFromTheWorkerThroughTheHopClosesTheRelayWith1009(t *testing.T) {
	t.Parallel()
	a, b := newHopPair(t, nil)
	relay, ready := a.open()
	twilio := b.join(ready.RelayID)
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)

	send(t, relay, websocket.MessageBinary, make([]byte, 64*1024+1))

	t.Run("the relay is closed with 1009", func(t *testing.T) {
		code, _ := fromRelay.ended(t, 3*time.Second)
		assert.Equal(t, websocket.StatusMessageTooBig, code)
	})
	t.Run("Twilio's socket is closed with 1000", func(t *testing.T) {
		code, _ := fromTwilio.ended(t, 3*time.Second)
		assert.Equal(t, websocket.StatusNormalClosure, code)
	})
}
