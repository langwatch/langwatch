package httpapi

// The Twilio media relay endpoints, through the whole router: a worker opens a
// relay, Twilio dials the gateway with the relay id, and the gateway joins the
// two sockets and moves frames verbatim. Every socket here is a real
// coder/websocket client against an httptest server.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/voicesession"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	mrSecret   = "media-relay-test-internal-secret"
	mrInstance = "instance-a"
	mrOrg      = "org-1"

	mrRelayPath  = "/v1/voice/relay"
	mrTwilioPath = "/v1/voice/twilio/"

	// The close codes a worker is told, and the reasons that go with them.
	mrCloseExpired     = websocket.StatusCode(4408)
	mrCloseMaxDuration = websocket.StatusCode(4409)
	mrClosePeerLost    = websocket.StatusCode(4502)
	mrCloseDrain       = websocket.StatusCode(1012)

	mrForbiddenCode   = "voice_relay_forbidden"
	mrUnavailableCode = "voice_relay_unavailable"
	mrLicenseCode     = "voice_relay_license_required"
)

var (
	mrOutcomes = []string{
		"opened", "paired", "refused_auth", "refused_unknown", "refused_expired",
		"refused_replay", "refused_unpaired", "expired_unpaired", "dropped", "completed",
	}
	mrIDShape = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

// mrToken is an lwl_ token whose name picks how mrAuth answers.
func mrToken(name string) string {
	return domain.LicenseTokenPrefix + name + strings.Repeat("a", 64)
}

// mrAuth resolves the tokens the tests present. The token name or the
// instance id picks the answer; it records every key it is asked about.
type mrAuth struct {
	mu   sync.Mutex
	seen []domain.PresentedKey
}

func (a *mrAuth) Resolve(ctx context.Context, key domain.PresentedKey) (*domain.Bundle, error) {
	a.mu.Lock()
	a.seen = append(a.seen, key)
	a.mu.Unlock()
	switch {
	case strings.HasPrefix(key.Token, domain.LicenseTokenPrefix+"unregistered"):
		return nil, herr.New(ctx, domain.ErrConnectLicenseNotRegistered, nil)
	case strings.HasPrefix(key.Token, domain.LicenseTokenPrefix+"revoked"):
		return nil, herr.New(ctx, domain.ErrConnectLicenseRevoked, nil)
	case strings.HasPrefix(key.Token, domain.LicenseTokenPrefix+"expired"):
		return nil, herr.New(ctx, domain.ErrConnectLicenseExpired, nil)
	case key.IsLicenseToken() && key.InstanceID == "wrong-instance":
		return nil, herr.New(ctx, domain.ErrConnectWrongInstance, nil)
	case key.IsLicenseToken():
		bundle := testBundle()
		bundle.ConnectServices = []string{domain.ConnectServiceManagedModels}
		return bundle, nil
	}
	return testBundle(), nil
}

// mrGateway is the full router with the media relay mounted.
type mrGateway struct {
	t       *testing.T
	server  *httptest.Server
	hub     *mediarelay.Hub
	metrics *gatewaymetrics.Recorder
	auth    *mrAuth
}

type mrBuild struct {
	hub  mediarelay.Options
	deps RouterDeps
	wrap func(http.Handler) http.Handler
}

type mrOpt func(*mrBuild)

func withHub(configure func(*mediarelay.Options)) mrOpt {
	return func(b *mrBuild) { configure(&b.hub) }
}

func withDeps(configure func(*RouterDeps)) mrOpt {
	return func(b *mrBuild) { configure(&b.deps) }
}

func withWrap(wrap func(http.Handler) http.Handler) mrOpt {
	return func(b *mrBuild) { b.wrap = wrap }
}

func newMRGateway(t *testing.T, opts ...mrOpt) *mrGateway {
	t.Helper()
	g := &mrGateway{t: t, metrics: gatewaymetrics.New(), auth: &mrAuth{}}
	build := &mrBuild{
		hub: mediarelay.Options{
			Secret:             mrSecret,
			PendingTTL:         150 * time.Second,
			MaxRelayDuration:   330 * time.Second,
			PingInterval:       20 * time.Second,
			DrainBudget:        time.Hour,
			MaxRelays:          500,
			MaxPendingPerScope: 20,
			Logger:             zap.NewNop(),
			Metrics:            g.metrics,
		},
		deps: RouterDeps{
			App:            app.New(app.WithAuth(g.auth), app.WithLogger(zap.NewNop())),
			Logger:         zap.NewNop(),
			Metrics:        g.metrics,
			Version:        "test",
			InternalSecret: mrSecret,
		},
	}
	for _, opt := range opts {
		opt(build)
	}
	g.hub = mediarelay.NewHub(build.hub)
	build.deps.MediaRelay = g.hub
	handler := NewRouter(build.deps)
	if build.wrap != nil {
		handler = build.wrap(handler)
	}
	g.server = httptest.NewServer(handler)
	t.Cleanup(g.server.Close)
	return g
}

// dial upgrades on path. A refused upgrade answers the handshake response.
func (g *mrGateway) dial(path string, opts *websocket.DialOptions) (*websocket.Conn, *http.Response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, g.server.URL+path, opts)
	if conn != nil {
		conn.SetReadLimit(1 << 20)
		g.t.Cleanup(func() { _ = conn.CloseNow() })
	}
	return conn, resp, err
}

func (g *mrGateway) dialRelay(header http.Header) (*websocket.Conn, *http.Response, error) {
	return g.dial(mrRelayPath, &websocket.DialOptions{HTTPHeader: header})
}

func (g *mrGateway) dialSigned(org string, header http.Header) (*websocket.Conn, *http.Response, error) {
	return g.dial(mrRelayPath+"/"+org, &websocket.DialOptions{HTTPHeader: header})
}

func (g *mrGateway) dialTwilio(id string) (*websocket.Conn, *http.Response, error) {
	return g.dial(mrTwilioPath+id, nil)
}

func licensedHeader() http.Header {
	return licensedHeaderFor(mrInstance)
}

func licensedHeaderFor(instance string) http.Header {
	header := bearer(mrToken("ok"))
	header.Set("X-LangWatch-Instance", instance)
	return header
}

// signedHeader signs GET path with an empty body, issued age ago.
func signedHeader(secret, path string, age time.Duration) http.Header {
	timestamp := strconv.FormatInt(time.Now().Add(-age).Unix(), 10)
	header := http.Header{}
	header.Set("X-LangWatch-Gateway-Signature", computeSignature(secret, http.MethodGet, path, timestamp, nil))
	header.Set("X-LangWatch-Gateway-Timestamp", timestamp)
	return header
}

func signedOrgHeader(org string) http.Header {
	return signedHeader(mrSecret, mrRelayPath+"/"+org, 0)
}

type mrReady struct {
	Event            string `json:"event"`
	RelayID          string `json:"relay_id"`
	StreamPath       string `json:"stream_path"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
}

// readReady reads the ready frame of a freshly opened relay.
func readReady(t *testing.T, conn *websocket.Conn) mrReady {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	kind, data, err := conn.Read(ctx)
	require.NoError(t, err)
	require.Equal(t, websocket.MessageText, kind, "the ready frame is text")
	root := gjson.ParseBytes(data)
	return mrReady{
		Event:            root.Get("event").String(),
		RelayID:          root.Get("relay_id").String(),
		StreamPath:       root.Get("stream_path").String(),
		ExpiresInSeconds: int(root.Get("expires_in_seconds").Int()),
	}
}

// open opens a relay with the install's lwl_ token and reads its ready frame.
func (g *mrGateway) open() (*websocket.Conn, mrReady) {
	g.t.Helper()
	conn, resp, err := g.dialRelay(licensedHeader())
	require.NoError(g.t, err, "relay open: %v", resp)
	return conn, readReady(g.t, conn)
}

// openSigned opens a relay with a request signed for one organization.
func (g *mrGateway) openSigned(org string) (*websocket.Conn, mrReady) {
	g.t.Helper()
	conn, resp, err := g.dialSigned(org, signedOrgHeader(org))
	require.NoError(g.t, err, "signed relay open: %v", resp)
	return conn, readReady(g.t, conn)
}

// join connects a Twilio-shaped client to a relay.
func (g *mrGateway) join(id string) *websocket.Conn {
	g.t.Helper()
	conn, resp, err := g.dialTwilio(id)
	require.NoError(g.t, err, "twilio join: %v", resp)
	return conn
}

// pair opens a relay and joins it. Neither socket is read yet.
func (g *mrGateway) pair() (relay, twilio *websocket.Conn, id string) {
	g.t.Helper()
	relay, ready := g.open()
	return relay, g.join(ready.RelayID), ready.RelayID
}

func (g *mrGateway) waitForNoRelays() {
	g.t.Helper()
	require.Eventually(g.t, func() bool { return g.hub.Active() == 0 }, 2*time.Second, 10*time.Millisecond,
		"relay slots were not released")
}

// outcomes reads gateway_voice_media_relay_total by outcome.
func (g *mrGateway) outcomes() map[string]float64 {
	g.t.Helper()
	families, err := g.metrics.Registry().Gather()
	require.NoError(g.t, err)
	counts := make(map[string]float64, len(mrOutcomes))
	for _, outcome := range mrOutcomes {
		counts[outcome] = 0
	}
	for _, family := range families {
		if family.GetName() != "gateway_voice_media_relay_total" {
			continue
		}
		for _, metric := range family.GetMetric() {
			for _, label := range metric.GetLabel() {
				if label.GetName() == "outcome" {
					counts[label.GetValue()] += metric.GetCounter().GetValue()
				}
			}
		}
	}
	return counts
}

func (g *mrGateway) expectOutcomes(want map[string]float64) {
	g.t.Helper()
	full := make(map[string]float64, len(mrOutcomes))
	for _, outcome := range mrOutcomes {
		full[outcome] = want[outcome]
	}
	require.Eventually(g.t, func() bool { return reflect.DeepEqual(full, g.outcomes()) },
		2*time.Second, 10*time.Millisecond)
	assert.Equal(g.t, full, g.outcomes())
}

// mrInbox reads a socket on its own goroutine, so a test can wait for the
// next frame or for the close without a read deadline closing the socket.
type mrFrame struct {
	kind websocket.MessageType
	data []byte
	err  error
}

type mrInbox struct{ frames chan mrFrame }

func inbox(conn *websocket.Conn) *mrInbox {
	in := &mrInbox{frames: make(chan mrFrame, 2048)}
	go func() {
		for {
			kind, data, err := conn.Read(context.Background())
			in.frames <- mrFrame{kind: kind, data: data, err: err}
			if err != nil {
				return
			}
		}
	}()
	return in
}

func (in *mrInbox) next(t *testing.T, within time.Duration) mrFrame {
	t.Helper()
	select {
	case frame := <-in.frames:
		return frame
	case <-time.After(within):
		t.Fatalf("no frame or close within %s", within)
		return mrFrame{}
	}
}

// ended waits for the close and answers its code and reason.
func (in *mrInbox) ended(t *testing.T, within time.Duration) (websocket.StatusCode, string) {
	t.Helper()
	deadline := time.After(within)
	for {
		select {
		case frame := <-in.frames:
			if frame.err != nil {
				return closeOf(frame.err)
			}
		case <-deadline:
			t.Fatalf("the socket did not close within %s", within)
			return 0, ""
		}
	}
}

func closeOf(err error) (websocket.StatusCode, string) {
	var closed websocket.CloseError
	if errors.As(err, &closed) {
		return closed.Code, closed.Reason
	}
	return -1, err.Error()
}

func send(t *testing.T, conn *websocket.Conn, kind websocket.MessageType, data []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(t, conn.Write(ctx, kind, data))
}

// expectFrame asserts the next frame is exactly this one.
func expectFrame(t *testing.T, in *mrInbox, kind websocket.MessageType, data []byte) {
	t.Helper()
	frame := in.next(t, 5*time.Second)
	require.NoError(t, frame.err)
	assert.Equal(t, kind, frame.kind)
	assert.True(t, bytes.Equal(data, frame.data), "frame bytes differ: want %d bytes, got %d", len(data), len(frame.data))
}

// refusedWith asserts a dial was refused before the upgrade.
func refusedWith(t *testing.T, resp *http.Response, err error, status int, code string) {
	t.Helper()
	require.Error(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, status, resp.StatusCode)
	if code != "" {
		assert.Equal(t, code, resp.Header.Get("X-LangWatch-Handled-Error"))
	}
}

func plainGet(t *testing.T, url string, header http.Header) int {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	require.NoError(t, err)
	req.Header = header.Clone()
	if req.Header == nil {
		req.Header = http.Header{}
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	return resp.StatusCode
}

// mrFrameOf builds frame i of a stream: text and binary alternate, and the
// binary ones carry every byte value so nothing may be re-encoded.
func mrFrameOf(from string, i int) (websocket.MessageType, []byte) {
	if i%2 == 0 {
		return websocket.MessageText, fmt.Appendf(nil, `{"event":"media","from":%q,"seq":%d}`, from, i)
	}
	data := make([]byte, i%97+1)
	for j := range data {
		data[j] = byte(i + j*31)
	}
	return websocket.MessageBinary, data
}

// ---------------------------------------------------------------------------
// Opening a relay
// ---------------------------------------------------------------------------

// @scenario "A licensed install opens a relay and is told where Twilio must connect"
func TestRelayOpenAnswersAReadyFrame(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.PendingTTL = 90 * time.Second }))

	conn, resp, err := g.dialRelay(licensedHeader())
	require.NoError(t, err)
	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	ready := readReady(t, conn)

	t.Run("the event", func(t *testing.T) {
		assert.Equal(t, "langwatch.relay.ready", ready.Event)
	})
	t.Run("a relay id that is not empty", func(t *testing.T) {
		assert.NotEmpty(t, ready.RelayID)
	})
	t.Run("a relay id without a slash", func(t *testing.T) {
		assert.NotContains(t, ready.RelayID, "/")
	})
	t.Run("the stream path Twilio must dial", func(t *testing.T) {
		assert.Equal(t, mrTwilioPath+ready.RelayID, ready.StreamPath)
	})
	t.Run("the pending time to live in seconds", func(t *testing.T) {
		assert.Equal(t, 90, ready.ExpiresInSeconds)
	})
	t.Run("the instance id reaches the auth resolver", func(t *testing.T) {
		g.auth.mu.Lock()
		defer g.auth.mu.Unlock()
		assert.Equal(t, mrInstance, g.auth.seen[0].InstanceID)
	})
}

// @scenario "A relay id fits in a Twilio stream URL"
func TestRelayIDFitsInAStreamURL(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) {
		o.PodIP = "10.255.255.255"
		o.BootID = "a1b2c3d4"
	}))

	_, ready := g.open()

	t.Run("at most 120 characters", func(t *testing.T) {
		assert.LessOrEqual(t, len(ready.RelayID), 120)
	})
	t.Run("base64url", func(t *testing.T) {
		assert.Regexp(t, mrIDShape, ready.RelayID)
	})
}

// @scenario "A relay request that is not a WebSocket upgrade is refused with 400"
func TestRelayOpenRefusesARequestThatIsNoUpgrade(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)

	t.Run("on the lwl_ route", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, http.StatusBadRequest, plainGet(t, g.server.URL+mrRelayPath, licensedHeader()))
	})
	t.Run("on the signed route", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, http.StatusBadRequest, plainGet(t, g.server.URL+mrRelayPath+"/"+mrOrg, signedOrgHeader(mrOrg)))
	})
	t.Run("and no slot is taken", func(t *testing.T) {
		assert.Zero(t, g.hub.Active())
	})
}

// @scenario "A cloud worker opens a relay with a request signed for one organization"
func TestSignedRelayOpenAnswersAReadyFrame(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)

	conn, resp, err := g.dialSigned(mrOrg, signedOrgHeader(mrOrg))
	require.NoError(t, err)
	ready := readReady(t, conn)

	t.Run("upgrades", func(t *testing.T) {
		assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	})
	t.Run("answers the ready event", func(t *testing.T) {
		assert.Equal(t, "langwatch.relay.ready", ready.Event)
	})
	t.Run("answers a relay id", func(t *testing.T) {
		assert.NotEmpty(t, ready.RelayID)
	})
}

// @scenario "The relay socket is refused before upgrade"
func TestRelayOpenIsRefusedBeforeTheUpgrade(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)

	for name, tc := range map[string]struct {
		header http.Header
		status int
		code   string
	}{
		"no credential":                 {nil, http.StatusUnauthorized, ""},
		"an unregistered lwl_ token":    {withInstance(bearer(mrToken("unregistered"))), http.StatusUnauthorized, "connect_license_not_registered"},
		"a revoked lwl_ token":          {withInstance(bearer(mrToken("revoked"))), http.StatusForbidden, "connect_license_revoked"},
		"an expired lwl_ token":         {withInstance(bearer(mrToken("expired"))), http.StatusForbidden, "connect_license_expired"},
		"an lwl_ token on the wrong id": {licensedHeaderFor("wrong-instance"), http.StatusForbidden, "connect_wrong_instance"},
		"a virtual key":                 {bearer(socketVirtualKey), http.StatusForbidden, mrLicenseCode},
		"HMAC headers and no bearer":    {signedHeader(mrSecret, mrRelayPath, 0), http.StatusUnauthorized, ""},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, resp, err := g.dialRelay(tc.header)

			refusedWith(t, resp, err, tc.status, tc.code)
		})
	}
	t.Run("no relay slot was taken", func(t *testing.T) {
		assert.Zero(t, g.hub.Active())
	})
}

func withInstance(header http.Header) http.Header {
	header.Set("X-LangWatch-Instance", mrInstance)
	return header
}

// @scenario "The signed relay route is refused before upgrade"
func TestSignedRelayOpenIsRefusedBeforeTheUpgrade(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	path := mrRelayPath + "/" + mrOrg

	for name, tc := range map[string]struct {
		header http.Header
		code   string
	}{
		"a bad signature":                            {signedHeader("not-the-secret", path, 0), "invalid_signature"},
		"a signature 301 seconds old":                {signedHeader(mrSecret, path, 301*time.Second), "timestamp_out_of_window"},
		"a signature over another organization path": {signedHeader(mrSecret, mrRelayPath+"/org-2", 0), "invalid_signature"},
		"a signature over /v1/voice/relay":           {signedHeader(mrSecret, mrRelayPath, 0), "invalid_signature"},
		"no signature headers":                       {nil, "missing_signature"},
		"only an lwl_ bearer token":                  {licensedHeader(), "missing_signature"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, resp, err := g.dialSigned(mrOrg, tc.header)

			refusedWith(t, resp, err, http.StatusUnauthorized, tc.code)
		})
	}
	t.Run("no relay slot was taken", func(t *testing.T) {
		assert.Zero(t, g.hub.Active())
	})
}

// @scenario "A gateway without an internal secret refuses signed relays"
func TestSignedRelayOpenFailsClosedWithoutAnInternalSecret(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withDeps(func(d *RouterDeps) { d.InternalSecret = "" }))

	conn, resp, err := g.dialSigned(mrOrg, signedOrgHeader(mrOrg))

	t.Run("the upgrade is refused", func(t *testing.T) {
		require.Error(t, err)
		assert.Nil(t, conn)
		assert.NotEqual(t, http.StatusSwitchingProtocols, resp.StatusCode)
	})
	t.Run("no relay slot is taken", func(t *testing.T) {
		assert.Zero(t, g.hub.Active())
	})
}

// ---------------------------------------------------------------------------
// Joining Twilio's socket to the relay
// ---------------------------------------------------------------------------

// @scenario "Frames pass between Twilio and the worker unchanged and in order"
func TestRelayPassesFramesUnchangedAndInOrder(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, _ := g.pair()
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)
	const frames = 500

	for i := range frames {
		kind, data := mrFrameOf("relay", i)
		send(t, relay, kind, data)
		kind, data = mrFrameOf("twilio", i)
		send(t, twilio, kind, data)
	}

	t.Run("the worker's frames reach Twilio", func(t *testing.T) {
		for i := range frames {
			kind, data := mrFrameOf("relay", i)
			expectFrame(t, fromTwilio, kind, data)
		}
	})
	t.Run("Twilio's frames reach the worker", func(t *testing.T) {
		for i := range frames {
			kind, data := mrFrameOf("twilio", i)
			expectFrame(t, fromRelay, kind, data)
		}
	})
}

// @scenario "Frames pass between Twilio and the worker unchanged and in order"
func TestRelayPassesAFrameOfExactly64KiB(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, _ := g.pair()
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)
	payload := make([]byte, 64*1024)
	rand.New(rand.NewSource(8397)).Read(payload) //nolint:gosec // fixed seed keeps the payload reproducible; not security-sensitive

	send(t, relay, websocket.MessageBinary, payload)
	send(t, twilio, websocket.MessageBinary, payload)

	t.Run("worker to Twilio", func(t *testing.T) {
		expectFrame(t, fromTwilio, websocket.MessageBinary, payload)
	})
	t.Run("Twilio to worker", func(t *testing.T) {
		expectFrame(t, fromRelay, websocket.MessageBinary, payload)
	})
}

// @scenario "A relay opened by a signed request is joined the same way"
func TestSignedRelayIsJoinedLikeAnyOther(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, ready := g.openSigned(mrOrg)
	twilio := g.join(ready.RelayID)

	send(t, twilio, websocket.MessageText, []byte(`{"event":"start"}`))
	send(t, relay, websocket.MessageText, []byte(`{"event":"media"}`))

	t.Run("Twilio to worker", func(t *testing.T) {
		expectFrame(t, inbox(relay), websocket.MessageText, []byte(`{"event":"start"}`))
	})
	t.Run("worker to Twilio", func(t *testing.T) {
		expectFrame(t, inbox(twilio), websocket.MessageText, []byte(`{"event":"media"}`))
	})
}

// @scenario "Twilio's socket is refused before upgrade"
func TestTwilioSocketIsRefusedBeforeTheUpgrade(t *testing.T) {
	t.Parallel()
	const ownPod = "10.0.0.1"
	soon := time.Now().Add(time.Minute)
	seal := func(secret string, claims mediarelay.IDClaims) string {
		id, err := mediarelay.NewIDCodec(secret).Seal(claims)
		require.NoError(t, err)
		return id
	}

	for name, prepare := range map[string]func(t *testing.T, g *mrGateway) string{
		"a random string": func(*testing.T, *mrGateway) string { return "not-a-relay-id" },
		"an id sealed with another key": func(*testing.T, *mrGateway) string {
			return seal("another-secret", mediarelay.IDClaims{OwnerPodIP: ownPod, ExpiresAt: soon})
		},
		"an expired id": func(*testing.T, *mrGateway) string {
			return seal(mrSecret, mediarelay.IDClaims{OwnerPodIP: ownPod, ExpiresAt: time.Now().Add(-time.Minute)})
		},
		"an id never opened on this pod": func(*testing.T, *mrGateway) string {
			return seal(mrSecret, mediarelay.IDClaims{OwnerPodIP: ownPod, ExpiresAt: soon})
		},
		"an id owned by another pod": func(*testing.T, *mrGateway) string {
			return seal(mrSecret, mediarelay.IDClaims{OwnerPodIP: "10.9.9.9", ExpiresAt: soon})
		},
		"an id already joined once": func(_ *testing.T, g *mrGateway) string {
			_, _, id := g.pair()
			return id
		},
		"an id whose Twilio socket has since closed": func(t *testing.T, g *mrGateway) string {
			t.Helper()
			relay, twilio, id := g.pair()
			inbox(relay)
			require.NoError(t, twilio.Close(websocket.StatusNormalClosure, ""))
			g.waitForNoRelays()
			return id
		},
		"an id whose relay was closed by the worker": func(t *testing.T, g *mrGateway) string {
			t.Helper()
			relay, ready := g.open()
			require.NoError(t, relay.Close(websocket.StatusNormalClosure, ""))
			g.waitForNoRelays()
			return ready.RelayID
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			g := newMRGateway(t, withHub(func(o *mediarelay.Options) {
				o.PodIP = ownPod
				o.BootID = "a1b2c3d4"
				// "owned by another pod" dials; keep an unanswered dial short.
				o.HopTimeout = 200 * time.Millisecond
			}))
			id := prepare(t, g)

			conn, resp, err := g.dialTwilio(id)

			assert.Nil(t, conn)
			refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
		})
	}
}

// @scenario "A replayed id does not disturb the pair that holds it"
func TestReplayedIDLeavesTheJoinedPairRunning(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, id := g.pair()

	_, resp, err := g.dialTwilio(id)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	send(t, relay, websocket.MessageText, []byte(`{"after":"replay"}`))

	expectFrame(t, inbox(twilio), websocket.MessageText, []byte(`{"after":"replay"}`))
}

// @scenario "A plain GET to the Twilio path does not use up the relay id"
func TestPlainGetToTheTwilioPathLeavesTheIDUsable(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, ready := g.open()

	status := plainGet(t, g.server.URL+ready.StreamPath, nil)
	twilio, _, err := g.dialTwilio(ready.RelayID)

	t.Run("the plain GET is a bad request", func(t *testing.T) {
		assert.Equal(t, http.StatusBadRequest, status)
	})
	t.Run("a Twilio-shaped client can still join", func(t *testing.T) {
		require.NoError(t, err)
		send(t, twilio, websocket.MessageText, []byte("hello"))
		expectFrame(t, inbox(relay), websocket.MessageText, []byte("hello"))
	})
}

// @scenario "No compression is negotiated on either socket"
func TestNoCompressionIsNegotiated(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	offer := func(header http.Header) *websocket.DialOptions {
		return &websocket.DialOptions{HTTPHeader: header, CompressionMode: websocket.CompressionContextTakeover}
	}

	relay, relayResp, err := g.dial(mrRelayPath, offer(licensedHeader()))
	require.NoError(t, err)
	ready := readReady(t, relay)
	_, twilioResp, err := g.dial(mrTwilioPath+ready.RelayID, offer(nil))
	require.NoError(t, err)

	t.Run("the worker's handshake", func(t *testing.T) {
		assert.Empty(t, relayResp.Header.Get("Sec-WebSocket-Extensions"))
	})
	t.Run("Twilio's handshake", func(t *testing.T) {
		assert.Empty(t, twilioResp.Header.Get("Sec-WebSocket-Extensions"))
	})
}

// @scenario "A relay id owned by this pod's address is accepted"
func TestRelayOwnedByThisPodIsJoined(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) {
		o.PodIP = "10.0.0.1"
		o.BootID = "a1b2c3d4"
	}))
	relay, twilio, _ := g.pair()

	send(t, relay, websocket.MessageText, []byte("ping-from-worker"))

	expectFrame(t, inbox(twilio), websocket.MessageText, []byte("ping-from-worker"))
}

// ---------------------------------------------------------------------------
// Time: the pending clock, pings, the maximum duration
// ---------------------------------------------------------------------------

// @scenario "A relay nobody joins expires"
func TestRelayNobodyJoinsExpires(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.PendingTTL = 300 * time.Millisecond }))
	relay, ready := g.open()

	code, reason := inbox(relay).ended(t, 2*time.Second)

	t.Run("the relay is closed with 4408", func(t *testing.T) {
		assert.Equal(t, mrCloseExpired, code)
	})
	t.Run("the reason is relay_expired", func(t *testing.T) {
		assert.Equal(t, "relay_expired", reason)
	})
	t.Run("a later Twilio connect with that id gets 403", func(t *testing.T) {
		_, resp, err := g.dialTwilio(ready.RelayID)

		refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	})
	t.Run("its slot is free", func(t *testing.T) {
		g.waitForNoRelays()
	})
}

// @scenario "A relay waiting for Twilio is pinged"
func TestPendingRelayIsPinged(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) {
		o.PendingTTL = 5 * time.Second
		o.PingInterval = 50 * time.Millisecond
	}))
	var pings atomic.Int32
	relay, _, err := g.dial(mrRelayPath, &websocket.DialOptions{
		HTTPHeader: licensedHeader(),
		OnPingReceived: func(context.Context, []byte) bool {
			pings.Add(1)
			return true
		},
	})
	require.NoError(t, err)
	readReady(t, relay)
	inbox(relay)

	assert.Eventually(t, func() bool { return pings.Load() >= 2 }, 2*time.Second, 10*time.Millisecond)
}

// @scenario "Joining stops the pending clock"
func TestJoiningStopsThePendingClock(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.PendingTTL = 300 * time.Millisecond }))
	relay, twilio, _ := g.pair()
	fromTwilio := inbox(twilio)

	time.Sleep(700 * time.Millisecond)
	send(t, relay, websocket.MessageText, []byte("still-here"))

	expectFrame(t, fromTwilio, websocket.MessageText, []byte("still-here"))
}

// @scenario "A relay older than its maximum duration is closed with 4409"
func TestRelayOlderThanItsMaximumDurationIsClosed(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.MaxRelayDuration = 400 * time.Millisecond }))
	relay, twilio, _ := g.pair()
	fromTwilio := inbox(twilio)

	code, reason := inbox(relay).ended(t, 2*time.Second)

	t.Run("the relay is closed with 4409", func(t *testing.T) {
		assert.Equal(t, mrCloseMaxDuration, code)
	})
	t.Run("the reason is relay_max_duration", func(t *testing.T) {
		assert.Equal(t, "relay_max_duration", reason)
	})
	t.Run("Twilio's socket is closed with a close frame", func(t *testing.T) {
		twilioCode, _ := fromTwilio.ended(t, 2*time.Second)
		assert.NotEqual(t, websocket.StatusCode(-1), twilioCode)
	})
}

// @scenario "The maximum duration runs from the join, not from the open"
func TestMaximumDurationRunsFromTheJoin(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) {
		o.PendingTTL = 5 * time.Second
		o.MaxRelayDuration = 600 * time.Millisecond
	}))
	relay, ready := g.open()
	fromRelay := inbox(relay)
	time.Sleep(400 * time.Millisecond)
	twilio := g.join(ready.RelayID)
	fromTwilio := inbox(twilio)

	time.Sleep(300 * time.Millisecond) // 700 ms since the open, 300 ms since the join
	send(t, relay, websocket.MessageText, []byte("late-frame"))

	t.Run("frames still pass", func(t *testing.T) {
		expectFrame(t, fromTwilio, websocket.MessageText, []byte("late-frame"))
	})
	t.Run("the relay is closed with 4409 once the join is old enough", func(t *testing.T) {
		code, _ := fromRelay.ended(t, 2*time.Second)
		assert.Equal(t, mrCloseMaxDuration, code)
	})
}

// ---------------------------------------------------------------------------
// Either side ending the stream
// ---------------------------------------------------------------------------

// @scenario "Twilio closing the stream closes the relay with 1000"
func TestTwilioClosingClosesTheRelayWith1000(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, _ := g.pair()
	fromRelay := inbox(relay)

	require.NoError(t, twilio.Close(websocket.StatusNormalClosure, ""))

	code, _ := fromRelay.ended(t, 2*time.Second)
	assert.Equal(t, websocket.StatusNormalClosure, code)
}

// @scenario "The worker closing the relay closes Twilio's socket with 1000"
func TestWorkerClosingClosesTwilioWith1000(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, _ := g.pair()
	fromTwilio := inbox(twilio)

	require.NoError(t, relay.Close(websocket.StatusNormalClosure, ""))

	code, _ := fromTwilio.ended(t, 2*time.Second)
	assert.Equal(t, websocket.StatusNormalClosure, code)
}

// @scenario "Twilio's socket dropping abnormally closes the relay with 4502"
func TestTwilioDroppingClosesTheRelayWith4502(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, _ := g.pair()
	fromRelay := inbox(relay)

	require.NoError(t, twilio.CloseNow())

	code, reason := fromRelay.ended(t, 2*time.Second)
	t.Run("the code is 4502", func(t *testing.T) {
		assert.Equal(t, mrClosePeerLost, code)
	})
	t.Run("the reason is relay_peer_lost", func(t *testing.T) {
		assert.Equal(t, "relay_peer_lost", reason)
	})
}

// @scenario "A frame over 64 KiB closes the pair with 1009"
func TestOversizedFrameFromTwilioClosesThePairWith1009(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, _ := g.pair()
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)

	send(t, twilio, websocket.MessageBinary, make([]byte, 64*1024+1))

	t.Run("Twilio's socket is closed with 1009", func(t *testing.T) {
		code, _ := fromTwilio.ended(t, 2*time.Second)
		assert.Equal(t, websocket.StatusMessageTooBig, code)
	})
	t.Run("the relay is closed with 1009", func(t *testing.T) {
		code, _ := fromRelay.ended(t, 2*time.Second)
		assert.Equal(t, websocket.StatusMessageTooBig, code)
	})
}

// @scenario "The gateway keeps serving after an oversized frame"
func TestGatewayKeepsServingAfterAnOversizedFrame(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, _ := g.pair()
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)

	send(t, relay, websocket.MessageBinary, make([]byte, 64*1024+1))
	relayCode, _ := fromRelay.ended(t, 2*time.Second)
	g.waitForNoRelays()

	t.Run("the worker's socket is closed with 1009", func(t *testing.T) {
		assert.Equal(t, websocket.StatusMessageTooBig, relayCode)
	})
	t.Run("Twilio's socket is closed with a close frame", func(t *testing.T) {
		code, _ := fromTwilio.ended(t, 2*time.Second)
		assert.NotEqual(t, websocket.StatusCode(-1), code)
	})
	t.Run("a new relay can be opened and joined", func(t *testing.T) {
		next, nextTwilio, _ := g.pair()
		send(t, next, websocket.MessageText, []byte("alive"))
		expectFrame(t, inbox(nextTwilio), websocket.MessageText, []byte("alive"))
	})
}

// ---------------------------------------------------------------------------
// Draining, capacity
// ---------------------------------------------------------------------------

// @scenario "A draining gateway refuses new relays with 503"
func TestDrainingGatewayRefusesNewRelays(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	g.hub.BeginDrain()

	for name, dial := range map[string]func() (*websocket.Conn, *http.Response, error){
		"with an lwl_ token": func() (*websocket.Conn, *http.Response, error) { return g.dialRelay(licensedHeader()) },
		"with a signature": func() (*websocket.Conn, *http.Response, error) {
			return g.dialSigned(mrOrg, signedOrgHeader(mrOrg))
		},
	} {
		t.Run(name, func(t *testing.T) {
			conn, resp, err := dial()

			assert.Nil(t, conn)
			refusedWith(t, resp, err, http.StatusServiceUnavailable, mrUnavailableCode)
			assert.NotEmpty(t, resp.Header.Get("Retry-After"))
		})
	}
	t.Run("no relay slot is taken", func(t *testing.T) {
		assert.Zero(t, g.hub.Active())
	})
}

// @scenario "A paired relay keeps running while the gateway drains and ends with 1012"
func TestPairedRelayRunsThroughTheDrainAndEndsWith1012(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.DrainBudget = 500 * time.Millisecond }))
	relay, twilio, _ := g.pair()
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)

	g.hub.BeginDrain()
	send(t, relay, websocket.MessageText, []byte("during-drain-down"))
	send(t, twilio, websocket.MessageText, []byte("during-drain-up"))

	t.Run("a frame still passes to Twilio", func(t *testing.T) {
		expectFrame(t, fromTwilio, websocket.MessageText, []byte("during-drain-down"))
	})
	t.Run("a frame still passes to the worker", func(t *testing.T) {
		expectFrame(t, fromRelay, websocket.MessageText, []byte("during-drain-up"))
	})
	t.Run("when the budget ends the relay is closed with 1012", func(t *testing.T) {
		code, reason := fromRelay.ended(t, 2*time.Second)
		assert.Equal(t, mrCloseDrain, code)
		assert.Equal(t, "relay_drain", reason)
	})
	t.Run("and Twilio's socket is closed", func(t *testing.T) {
		code, _ := fromTwilio.ended(t, 2*time.Second)
		assert.NotEqual(t, websocket.StatusCode(-1), code)
	})
}

// @scenario "A relay waiting for Twilio can still be joined while the gateway drains"
func TestPendingRelayCanBeJoinedWhileDraining(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, ready := g.open()

	g.hub.BeginDrain()
	twilio := g.join(ready.RelayID)
	send(t, twilio, websocket.MessageText, []byte("joined-late"))

	expectFrame(t, inbox(relay), websocket.MessageText, []byte("joined-late"))
}

// @scenario "A full gateway refuses new relays with 503"
func TestFullGatewayRefusesNewRelays(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.MaxRelays = 1 }))
	g.open()

	for name, dial := range map[string]func() (*websocket.Conn, *http.Response, error){
		"with an lwl_ token": func() (*websocket.Conn, *http.Response, error) { return g.dialRelay(licensedHeader()) },
		"with a signature": func() (*websocket.Conn, *http.Response, error) {
			return g.dialSigned("org-2", signedOrgHeader("org-2"))
		},
	} {
		t.Run(name, func(t *testing.T) {
			conn, resp, err := dial()

			assert.Nil(t, conn)
			refusedWith(t, resp, err, http.StatusServiceUnavailable, mrUnavailableCode)
			assert.NotEmpty(t, resp.Header.Get("Retry-After"))
		})
	}
}

// @scenario "A slot is reusable once its relay ends"
func TestSlotIsReusableOnceItsRelayEnds(t *testing.T) {
	t.Parallel()

	t.Run("after the worker closes the relay", func(t *testing.T) {
		t.Parallel()
		g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.MaxRelays = 1 }))
		relay, _ := g.open()
		require.NoError(t, relay.Close(websocket.StatusNormalClosure, ""))
		g.waitForNoRelays()

		conn, resp, err := g.dialRelay(licensedHeader())

		require.NoError(t, err)
		assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
		assert.NotNil(t, conn)
	})
	t.Run("after Twilio closes the pair", func(t *testing.T) {
		t.Parallel()
		g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.MaxRelays = 1 }))
		relay, twilio, _ := g.pair()
		inbox(relay)
		require.NoError(t, twilio.Close(websocket.StatusNormalClosure, ""))
		g.waitForNoRelays()

		conn, resp, err := g.dialRelay(licensedHeader())

		require.NoError(t, err)
		assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
		assert.NotNil(t, conn)
	})
}

// @scenario "One scope cannot hold more pending relays than its cap"
func TestPendingRelaysAreCappedPerScope(t *testing.T) {
	t.Parallel()
	capOfTwo := withHub(func(o *mediarelay.Options) { o.MaxPendingPerScope = 2 })

	t.Run("per instance", func(t *testing.T) {
		t.Parallel()
		g := newMRGateway(t, capOfTwo)
		for range 2 {
			_, resp, err := g.dialRelay(licensedHeaderFor(mrInstance))
			require.NoError(t, err, "%v", resp)
		}

		_, resp, err := g.dialRelay(licensedHeaderFor(mrInstance))

		t.Run("the third is refused", func(t *testing.T) {
			refusedWith(t, resp, err, http.StatusServiceUnavailable, mrUnavailableCode)
			assert.NotEmpty(t, resp.Header.Get("Retry-After"))
		})
		t.Run("another instance can still open one", func(t *testing.T) {
			_, other, err := g.dialRelay(licensedHeaderFor("instance-b"))

			require.NoError(t, err)
			assert.Equal(t, http.StatusSwitchingProtocols, other.StatusCode)
		})
		t.Run("an organization is a different scope", func(t *testing.T) {
			_, other, err := g.dialSigned(mrOrg, signedOrgHeader(mrOrg))

			require.NoError(t, err)
			assert.Equal(t, http.StatusSwitchingProtocols, other.StatusCode)
		})
	})
	t.Run("per organization", func(t *testing.T) {
		t.Parallel()
		g := newMRGateway(t, capOfTwo)
		for range 2 {
			_, resp, err := g.dialSigned(mrOrg, signedOrgHeader(mrOrg))
			require.NoError(t, err, "%v", resp)
		}

		_, resp, err := g.dialSigned(mrOrg, signedOrgHeader(mrOrg))

		t.Run("the third is refused", func(t *testing.T) {
			refusedWith(t, resp, err, http.StatusServiceUnavailable, mrUnavailableCode)
		})
		t.Run("another organization can still open one", func(t *testing.T) {
			_, other, err := g.dialSigned("org-2", signedOrgHeader("org-2"))

			require.NoError(t, err)
			assert.Equal(t, http.StatusSwitchingProtocols, other.StatusCode)
		})
	})
}

// @scenario "Joined relays do not count against the pending cap"
func TestJoinedRelaysDoNotCountAgainstThePendingCap(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) { o.MaxPendingPerScope = 1 }))
	g.pair()

	second, resp, err := g.dialRelay(licensedHeader())
	require.NoError(t, err, "%v", resp)
	require.NotNil(t, second)
	_, resp, err = g.dialRelay(licensedHeader())

	refusedWith(t, resp, err, http.StatusServiceUnavailable, mrUnavailableCode)
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

// @scenario "Each relay outcome is counted once"
func TestEachRelayOutcomeIsCountedOnce(t *testing.T) {
	t.Parallel()
	seal := func(claims mediarelay.IDClaims) string {
		id, err := mediarelay.NewIDCodec(mrSecret).Seal(claims)
		require.NoError(t, err)
		return id
	}

	for name, tc := range map[string]struct {
		hub  func(*mediarelay.Options)
		run  func(t *testing.T, g *mrGateway)
		want map[string]float64
	}{
		"opened": {
			run:  func(_ *testing.T, g *mrGateway) { g.open() },
			want: map[string]float64{"opened": 1},
		},
		"paired": {
			run:  func(_ *testing.T, g *mrGateway) { g.pair() },
			want: map[string]float64{"opened": 1, "paired": 1},
		},
		"refused_auth by a virtual key": {
			run:  func(_ *testing.T, g *mrGateway) { _, _, _ = g.dialRelay(bearer(socketVirtualKey)) },
			want: map[string]float64{"refused_auth": 1},
		},
		"refused_auth by a bad signature": {
			run: func(_ *testing.T, g *mrGateway) {
				_, _, _ = g.dialSigned(mrOrg, signedHeader("not-the-secret", mrRelayPath+"/"+mrOrg, 0))
			},
			want: map[string]float64{"refused_auth": 1},
		},
		"refused_unknown": {
			run:  func(_ *testing.T, g *mrGateway) { _, _, _ = g.dialTwilio("not-a-relay-id") },
			want: map[string]float64{"refused_unknown": 1},
		},
		"refused_expired": {
			run: func(_ *testing.T, g *mrGateway) {
				_, _, _ = g.dialTwilio(seal(mediarelay.IDClaims{ExpiresAt: time.Now().Add(-time.Minute)}))
			},
			want: map[string]float64{"refused_expired": 1},
		},
		"refused_replay": {
			run: func(_ *testing.T, g *mrGateway) {
				_, _, id := g.pair()
				_, _, _ = g.dialTwilio(id)
			},
			want: map[string]float64{"opened": 1, "paired": 1, "refused_replay": 1},
		},
		"expired_unpaired": {
			hub:  func(o *mediarelay.Options) { o.PendingTTL = 200 * time.Millisecond },
			run:  func(_ *testing.T, g *mrGateway) { g.open() },
			want: map[string]float64{"opened": 1, "expired_unpaired": 1},
		},
		"dropped": {
			run: func(_ *testing.T, g *mrGateway) {
				relay, twilio, _ := g.pair()
				inbox(relay)
				_ = twilio.CloseNow()
			},
			want: map[string]float64{"opened": 1, "paired": 1, "dropped": 1},
		},
		"completed": {
			run: func(t *testing.T, g *mrGateway) {
				t.Helper()
				relay, twilio, _ := g.pair()
				inbox(relay)
				require.NoError(t, twilio.Close(websocket.StatusNormalClosure, ""))
			},
			want: map[string]float64{"opened": 1, "paired": 1, "completed": 1},
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			g := newMRGateway(t, withHub(func(o *mediarelay.Options) {
				if tc.hub != nil {
					tc.hub(o)
				}
			}))

			tc.run(t, g)

			g.expectOutcomes(tc.want)
		})
	}
}

// @scenario "Metric labels never carry a relay id"
func TestMetricLabelsNeverCarryARelayID(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, twilio, id := g.pair()
	inbox(relay)
	require.NoError(t, twilio.Close(websocket.StatusNormalClosure, ""))
	g.waitForNoRelays()
	_, _, _ = g.dialTwilio(id)

	families, err := g.metrics.Registry().Gather()
	require.NoError(t, err)
	var labelNames, outcomeValues []string
	for _, family := range families {
		if family.GetName() != "gateway_voice_media_relay_total" {
			continue
		}
		for _, metric := range family.GetMetric() {
			for _, label := range metric.GetLabel() {
				labelNames = append(labelNames, label.GetName())
				outcomeValues = append(outcomeValues, label.GetValue())
			}
		}
	}

	t.Run("the only label is outcome", func(t *testing.T) {
		require.NotEmpty(t, labelNames, "the family was never exported")
		assert.Subset(t, []string{"outcome"}, labelNames)
	})
	t.Run("its values are from the fixed set", func(t *testing.T) {
		assert.Subset(t, mrOutcomes, outcomeValues)
	})
}

// ---------------------------------------------------------------------------
// Telemetry hygiene
// ---------------------------------------------------------------------------

// mrTelemetry wires an observed logger into the router and the hub and a span
// recorder into the global tracer provider. It must be called before the
// gateway is built, because the tracer middleware resolves its tracer then.
// Tests that use it are not parallel: the provider is process-global.
type mrTelemetry struct {
	logs  *observer.ObservedLogs
	spans *tracetest.SpanRecorder
	opts  []mrOpt
}

func newMRTelemetry(t *testing.T) *mrTelemetry {
	t.Helper()
	core, logs := observer.New(zap.DebugLevel)
	spans := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.AlwaysSample()), sdktrace.WithSpanProcessor(spans))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})
	logger := zap.New(core)
	return &mrTelemetry{logs: logs, spans: spans, opts: []mrOpt{
		withHub(func(o *mediarelay.Options) { o.Logger = logger }),
		withDeps(func(d *RouterDeps) { d.Logger = logger }),
		withWrap(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				next.ServeHTTP(w, r.WithContext(clog.Set(r.Context(), logger)))
			})
		}),
	}}
}

func (m *mrTelemetry) logText() string {
	var text strings.Builder
	entries := m.logs.All()
	for i := range entries {
		fmt.Fprint(&text, entries[i].Message, " ", entries[i].ContextMap(), "\n")
	}
	return text.String()
}

func (m *mrTelemetry) spanText() string {
	var text strings.Builder
	for _, span := range m.spans.Ended() {
		text.WriteString(span.Name() + "\n")
		for _, attribute := range span.Attributes() {
			text.WriteString(string(attribute.Key) + "=" + attribute.Value.String() + "\n")
		}
	}
	return text.String()
}

// @scenario "The relay id never appears in full in logs or spans"
func TestRelayIDNeverAppearsInFullInLogsOrSpans(t *testing.T) {
	telemetry := newMRTelemetry(t)
	g := newMRGateway(t, telemetry.opts...)
	relay, twilio, id := g.pair()
	send(t, relay, websocket.MessageText, []byte("hello"))
	expectFrame(t, inbox(twilio), websocket.MessageText, []byte("hello"))
	middle := len(id) / 2
	_, resp, err := g.dialTwilio(id[:middle] + otherChar(id[middle]) + id[middle+1:])
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	_, resp, err = g.dialTwilio(id)
	refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	require.NoError(t, relay.Close(websocket.StatusNormalClosure, ""))
	g.waitForNoRelays()
	require.Eventually(t, func() bool {
		return strings.Contains(telemetry.spanText(), mrTwilioPath) && strings.Contains(telemetry.logText(), "request_completed")
	}, 2*time.Second, 10*time.Millisecond, "the Twilio request span or access log never appeared")

	leaked := id[:16] // a prefix of 8 is allowed; 16 is a leak
	spans, logs := telemetry.spanText(), telemetry.logText()

	t.Run("no span holds the full id", func(t *testing.T) {
		assert.NotContains(t, spans, id)
	})
	t.Run("no span holds more than a short prefix", func(t *testing.T) {
		assert.NotContains(t, spans, leaked)
	})
	t.Run("no log entry holds the full id", func(t *testing.T) {
		assert.NotContains(t, logs, id)
	})
	t.Run("no log entry holds more than a short prefix", func(t *testing.T) {
		assert.NotContains(t, logs, leaked)
	})
	t.Run("the Twilio request span still carries the path prefix", func(t *testing.T) {
		assert.Contains(t, spans, "url.path="+mrTwilioPath)
	})
}

func otherChar(c byte) string {
	if c == 'A' {
		return "B"
	}
	return "A"
}

// @scenario "Frame payloads never appear in logs"
func TestFramePayloadsNeverAppearInLogs(t *testing.T) {
	telemetry := newMRTelemetry(t)
	g := newMRGateway(t, telemetry.opts...)
	relay, twilio, _ := g.pair()
	fromRelay, fromTwilio := inbox(relay), inbox(twilio)
	const marker = "PAYLOAD-MARKER-7f3a9c"

	send(t, relay, websocket.MessageText, []byte(`{"audio":"`+marker+`-down"}`))
	send(t, twilio, websocket.MessageBinary, []byte(marker+"-up"))
	fromTwilio.next(t, 5*time.Second)
	fromRelay.next(t, 5*time.Second)
	require.NoError(t, relay.CloseNow())
	g.waitForNoRelays()

	assert.NotEmpty(t, telemetry.logs.All(), "nothing was logged, so the assertion below proves nothing")
	assert.NotContains(t, telemetry.logText(), marker)
}

// ---------------------------------------------------------------------------
// The real router
// ---------------------------------------------------------------------------

// @scenario "The upgrade works through the production middleware chain"
func TestRelayUpgradeWorksThroughTheProductionMiddlewareChain(t *testing.T) {
	telemetry := newMRTelemetry(t)
	g := newMRGateway(t, telemetry.opts...)

	relay, relayResp, err := g.dialRelay(licensedHeader())
	require.NoError(t, err)
	ready := readReady(t, relay)
	twilio, twilioResp, err := g.dialTwilio(ready.RelayID)
	require.NoError(t, err)
	send(t, relay, websocket.MessageText, []byte("through-the-chain"))

	t.Run("the worker's upgrade is 101", func(t *testing.T) {
		assert.Equal(t, http.StatusSwitchingProtocols, relayResp.StatusCode)
	})
	t.Run("Twilio's upgrade is 101", func(t *testing.T) {
		assert.Equal(t, http.StatusSwitchingProtocols, twilioResp.StatusCode)
	})
	t.Run("the responses carry the gateway version", func(t *testing.T) {
		assert.Equal(t, "test", relayResp.Header.Get("X-LangWatch-Gateway-Version"))
		assert.Equal(t, "test", twilioResp.Header.Get("X-LangWatch-Gateway-Version"))
	})
	t.Run("the responses carry a request id", func(t *testing.T) {
		assert.NotEmpty(t, relayResp.Header.Get("X-LangWatch-Gateway-Request-Id"))
		assert.NotEmpty(t, twilioResp.Header.Get("X-LangWatch-Gateway-Request-Id"))
	})
	t.Run("frames pass", func(t *testing.T) {
		expectFrame(t, inbox(twilio), websocket.MessageText, []byte("through-the-chain"))
	})
}

// @scenario "A vendor voice socket still upgrades when the media relay is mounted"
func TestVendorVoiceSocketStillUpgradesWithTheMediaRelayMounted(t *testing.T) {
	t.Parallel()
	vendor := newSocketVendor(t)
	world := &brokerWorld{}
	manager := voicesession.NewManager(voicesession.Options{
		Registry: world,
		Vendor:   voicesession.NewOpenAIVendor(vendor.server.Client(), nil),
		RelayEndpoint: func(cred domain.Credential, path string) string {
			return cred.Extra["base_url"] + path
		},
		DrainBudget: time.Hour,
	})
	auth := &mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
		bundle := testBundle()
		bundle.Credentials = []domain.Credential{{
			ID: "cred-openai", ProviderID: domain.ProviderOpenAI, APIKey: "sk-provider-openai",
			Extra: map[string]string{"base_url": vendor.server.URL},
		}}
		return bundle, nil
	}}
	server := httptest.NewServer(NewRouter(RouterDeps{
		App: app.New(
			app.WithAuth(auth),
			app.WithProviders(&mockProvider{}),
			app.WithModels(modelresolver.New()),
			app.WithRealtimeSessions(world),
			app.WithVoiceSupervisor(manager),
			app.WithLogger(zap.NewNop()),
		),
		Logger:         zap.NewNop(),
		Metrics:        gatewaymetrics.New(),
		Version:        "test",
		InternalSecret: mrSecret,
		VoiceRelay:     manager,
		MediaRelay: mediarelay.NewHub(mediarelay.Options{
			Secret: mrSecret, PendingTTL: time.Minute, MaxRelayDuration: time.Minute,
			PingInterval: 20 * time.Second, DrainBudget: time.Hour, MaxRelays: 10, MaxPendingPerScope: 10,
		}),
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, resp, err := websocket.Dial(ctx, server.URL+"/v1/realtime?model=gpt-realtime", &websocket.DialOptions{
		HTTPHeader: bearer(socketVirtualKey),
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.CloseNow() })
	send(t, client, websocket.MessageBinary, []byte{0, 1, 2, 3})

	t.Run("the upgrade succeeds", func(t *testing.T) {
		assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	})
	t.Run("its frames reach the vendor", func(t *testing.T) {
		assert.Equal(t, "\x00\x01\x02\x03", vendor.frame())
	})
}
