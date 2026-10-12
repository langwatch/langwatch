package mediarelay_test

// The Hub's lifecycle against real sockets: the drain that a shutdown signal
// starts, Stop, and the race between Twilio's claim and its upgrade.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const hubScope = "instance:hub-test"

// hubFixture serves a Hub's Open on /open and Join on /twilio/{id}.
type hubFixture struct {
	t      *testing.T
	hub    *mediarelay.Hub
	server *httptest.Server
}

// newHubFixture builds a Hub with short timers. wrapJoin, when set, wraps the
// response writer Join upgrades.
func newHubFixture(t *testing.T, tune func(*mediarelay.Options), wrapJoin func(http.ResponseWriter) http.ResponseWriter) *hubFixture {
	t.Helper()
	opts := mediarelay.Options{Secret: "hub-test-secret", PendingTTL: 30 * time.Second, DrainBudget: time.Hour}
	if tune != nil {
		tune(&opts)
	}
	hub := mediarelay.NewHub(opts)
	mux := http.NewServeMux()
	mux.HandleFunc("/open", func(w http.ResponseWriter, r *http.Request) {
		if err := hub.Open(w, r, hubScope); err != nil {
			status := http.StatusInternalServerError
			if herr.IsCode(err, domain.ErrVoiceRelayUnavailable) {
				status = http.StatusServiceUnavailable
			}
			http.Error(w, err.Error(), status)
		}
	})
	mux.HandleFunc("/twilio/", func(w http.ResponseWriter, r *http.Request) {
		if wrapJoin != nil {
			w = wrapJoin(w)
		}
		if err := hub.Join(w, r, strings.TrimPrefix(r.URL.Path, "/twilio/")); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
		}
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return &hubFixture{t: t, hub: hub, server: server}
}

func (f *hubFixture) dial(path string) (*websocket.Conn, *http.Response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, f.server.URL+path, nil)
	if conn != nil {
		f.t.Cleanup(func() { _ = conn.CloseNow() })
	}
	return conn, resp, err
}

// open opens a relay and reads its id from the ready frame.
func (f *hubFixture) open() (*websocket.Conn, string) {
	f.t.Helper()
	worker, resp, err := f.dial("/open")
	require.NoError(f.t, err, "open: %v", resp)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := worker.Read(ctx)
	require.NoError(f.t, err)
	var ready struct {
		RelayID string `json:"relay_id"`
	}
	require.NoError(f.t, json.Unmarshal(data, &ready))
	return worker, ready.RelayID
}

// pair opens a relay and joins it.
func (f *hubFixture) pair() (worker, twilio *websocket.Conn) {
	f.t.Helper()
	worker, id := f.open()
	twilio, resp, err := f.dial("/twilio/" + id)
	require.NoError(f.t, err, "join: %v", resp)
	return worker, twilio
}

// closeOf reads conn until it closes and answers the close code and reason,
// or -1 when the socket dropped without a close frame.
func closeOf(conn *websocket.Conn, within time.Duration) (websocket.StatusCode, string) {
	ctx, cancel := context.WithTimeout(context.Background(), within)
	defer cancel()
	for {
		if _, _, err := conn.Read(ctx); err != nil {
			var closed websocket.CloseError
			if errors.As(err, &closed) {
				return closed.Code, closed.Reason
			}
			return -1, err.Error()
		}
	}
}

// @scenario "A shutdown signal starts the drain"
func TestStartDrainsWhenItsContextEnds(t *testing.T) {
	t.Parallel()
	f := newHubFixture(t, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	require.NoError(t, f.hub.Start(ctx))
	cancel()

	var status int
	require.Eventually(t, func() bool {
		conn, resp, err := f.dial("/open")
		if err == nil {
			_ = conn.CloseNow()
			return false
		}
		status = resp.StatusCode
		return status == http.StatusServiceUnavailable
	}, time.Second, 10*time.Millisecond, "the hub kept opening relays after its context ended, last status %d", status)
}

// @scenario "A paired relay is closed with 1012 once a shutdown signal and the drain budget pass"
func TestPairedRelayIsClosedWith1012AfterTheContextEnds(t *testing.T) {
	t.Parallel()
	f := newHubFixture(t, func(o *mediarelay.Options) { o.DrainBudget = 200 * time.Millisecond }, nil)
	ctx, cancel := context.WithCancel(context.Background())
	require.NoError(t, f.hub.Start(ctx))
	worker, twilio := f.pair()
	go closeOf(twilio, 5*time.Second)

	cancel()
	code, reason := closeOf(worker, 3*time.Second)

	t.Run("the worker is closed with 1012", func(t *testing.T) {
		assert.Equal(t, mediarelay.CloseDrain, code)
	})
	t.Run("the reason is relay_drain", func(t *testing.T) {
		assert.Equal(t, "relay_drain", reason)
	})
}

// @scenario "Stopping the hub returns once every relay has ended"
func TestStopReturnsOnceTheRelaysEnd(t *testing.T) {
	t.Parallel()
	f := newHubFixture(t, func(o *mediarelay.Options) { o.DrainBudget = 200 * time.Millisecond }, nil)
	worker, twilio := f.pair()
	go closeOf(worker, 5*time.Second)
	go closeOf(twilio, 5*time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	err := f.hub.Stop(ctx)

	t.Run("Stop returns without an error", func(t *testing.T) {
		assert.NoError(t, err)
	})
	t.Run("no relay is held", func(t *testing.T) {
		assert.Zero(t, f.hub.Active())
	})
}

// @scenario "Stopping the hub returns the deadline error when the deadline passes first"
func TestStopReturnsTheDeadlineErrorWhenItPassesFirst(t *testing.T) {
	t.Parallel()
	f := newHubFixture(t, nil, nil)
	worker, twilio := f.pair()
	go closeOf(twilio, 5*time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	err := f.hub.Stop(ctx)

	t.Run("Stop returns the deadline error", func(t *testing.T) {
		assert.ErrorIs(t, err, context.DeadlineExceeded)
	})
	t.Run("the relay is then closed with 1012", func(t *testing.T) {
		code, reason := closeOf(worker, 3*time.Second)
		assert.Equal(t, mediarelay.CloseDrain, code, "reason %q", reason)
	})
}

// gatedHijack holds Join between its claim and its upgrade: Accept hijacks
// the connection only after the claim has been taken.
type gatedHijack struct {
	http.ResponseWriter
	reached chan<- struct{}
	proceed <-chan struct{}
}

func (g gatedHijack) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	close(g.reached)
	<-g.proceed
	return g.ResponseWriter.(http.Hijacker).Hijack()
}

// @scenario "A relay that ended between the claim and the upgrade closes Twilio with a code"
func TestJoinClosesTwilioWithACodeWhenTheRelayEndedMeanwhile(t *testing.T) {
	t.Parallel()
	reached, proceed := make(chan struct{}), make(chan struct{})
	f := newHubFixture(t, nil, func(w http.ResponseWriter) http.ResponseWriter {
		return gatedHijack{ResponseWriter: w, reached: reached, proceed: proceed}
	})
	worker, id := f.open()
	type dialed struct {
		conn *websocket.Conn
		err  error
	}
	result := make(chan dialed, 1)
	go func() {
		conn, _, err := f.dial("/twilio/" + id)
		result <- dialed{conn, err}
	}()
	select {
	case <-reached:
	case <-time.After(5 * time.Second):
		t.Fatal("Join never reached its upgrade")
	}
	_ = worker.CloseNow()
	require.Eventually(t, func() bool { return f.hub.Active() == 0 }, 2*time.Second, 10*time.Millisecond,
		"the relay was not released after the worker left")
	close(proceed)

	var got dialed
	select {
	case got = <-result:
	case <-time.After(5 * time.Second):
		t.Fatal("Twilio's upgrade never completed")
	}
	require.NoError(t, got.err)
	// The worker vanished, so the relay ends as peer lost and Join passes that code on.
	code, reason := closeOf(got.conn, 3*time.Second)

	assert.Equal(t, mediarelay.ClosePeerLost, code)
	assert.Equal(t, "relay_ended", reason)
}
