package httpapi

// The socket routes of the WebSocket relay, through the whole router: the
// upgrade, the key swap, and what each route reads of the client's frames.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/voicesession"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const socketVirtualKey = "vk-lw-socket-secret"

// socketVendor is the vendor's side of a relayed socket.
type socketVendor struct {
	t      *testing.T
	server *httptest.Server

	mu       sync.Mutex
	requests []string
	urls     []string
	headers  []http.Header
	frames   chan string
	conns    chan *websocket.Conn
}

func newSocketVendor(t *testing.T) *socketVendor {
	t.Helper()
	v := &socketVendor{t: t, frames: make(chan string, 64), conns: make(chan *websocket.Conn, 4)}
	v.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dump, _ := httputil.DumpRequest(r, false)
		v.mu.Lock()
		v.requests = append(v.requests, string(dump))
		v.urls = append(v.urls, r.URL.RequestURI())
		v.headers = append(v.headers, r.Header.Clone())
		v.mu.Unlock()
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"realtime"}})
		if err != nil {
			return
		}
		v.conns <- conn
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			v.frames <- string(data)
		}
	}))
	t.Cleanup(v.server.Close)
	return v
}

func (v *socketVendor) frame() string {
	v.t.Helper()
	select {
	case frame := <-v.frames:
		return frame
	case <-time.After(5 * time.Second):
		v.t.Fatal("the vendor received no frame")
		return ""
	}
}

func (v *socketVendor) conn() *websocket.Conn {
	v.t.Helper()
	select {
	case conn := <-v.conns:
		return conn
	case <-time.After(5 * time.Second):
		v.t.Fatal("the gateway never dialed the vendor")
		return nil
	}
}

func (v *socketVendor) dialed() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return len(v.requests)
}

// socketGateway is the full router in front of a fake vendor.
type socketGateway struct {
	t       *testing.T
	world   *brokerWorld
	vendor  *socketVendor
	manager *voicesession.Manager
	server  *httptest.Server

	mu     sync.Mutex
	tokens []string
}

func newSocketGateway(t *testing.T, world *brokerWorld, configure func(*voicesession.Options), extra ...app.Option) *socketGateway {
	t.Helper()
	g := &socketGateway{t: t, world: world, vendor: newSocketVendor(t)}
	opts := voicesession.Options{
		Registry: world,
		Vendor:   voicesession.NewOpenAIVendor(g.vendor.server.Client(), nil),
		RelayEndpoint: func(cred domain.Credential, path string) string {
			return cred.Extra["base_url"] + path
		},
		DrainBudget: time.Hour,
	}
	if configure != nil {
		configure(&opts)
	}
	g.manager = voicesession.NewManager(opts)

	base := map[string]string{"base_url": g.vendor.server.URL}
	auth := &mockAuth{resolveFn: func(_ context.Context, token string) (*domain.Bundle, error) {
		g.mu.Lock()
		g.tokens = append(g.tokens, token)
		g.mu.Unlock()
		bundle := testBundle()
		bundle.Credentials = []domain.Credential{
			{ID: "cred-openai", ProviderID: domain.ProviderOpenAI, APIKey: "sk-provider-openai", Extra: base},
			{ID: "cred-11labs", ProviderID: domain.ProviderElevenLabs, APIKey: "sk-provider-11labs", Extra: base},
		}
		config := world.config
		config.Fallback = domain.FallbackConfig{MaxAttempts: 1}
		bundle.Config = config
		return bundle, nil
	}}
	appOpts := []app.Option{
		app.WithAuth(auth),
		app.WithProviders(&mockProvider{}),
		app.WithModels(modelresolver.New()),
		app.WithRealtimeSessions(world),
		app.WithVoiceSupervisor(g.manager),
		app.WithLogger(zap.NewNop()),
	}
	registry := health.New("test")
	registry.MarkStarted()
	g.server = httptest.NewServer(NewRouter(RouterDeps{
		App:        app.New(append(appOpts, extra...)...),
		Logger:     zap.NewNop(),
		Health:     registry,
		Metrics:    gatewaymetrics.New(),
		Version:    "test",
		VoiceRelay: g.manager,
	}))
	t.Cleanup(g.server.Close)
	return g
}

// dial upgrades on target. The response is the handshake answer, which is
// what a refused upgrade is read from.
func (g *socketGateway) dial(target string, header http.Header, subprotocols ...string) (*websocket.Conn, *http.Response, error) {
	conn, resp, err := websocket.Dial(context.Background(), g.server.URL+target, &websocket.DialOptions{
		HTTPHeader:   header,
		Subprotocols: subprotocols,
	})
	if conn != nil {
		g.t.Cleanup(func() { _ = conn.CloseNow() })
	}
	return conn, resp, err
}

func bearer(key string) http.Header {
	header := http.Header{}
	header.Set("Authorization", "Bearer "+key)
	return header
}

func (g *socketGateway) reservation() domain.RealtimeReservation {
	g.world.mu.Lock()
	defer g.world.mu.Unlock()
	require.Len(g.t, g.world.reserved, 1)
	return g.world.reserved[0]
}

func readSocket(t *testing.T, conn *websocket.Conn) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	return string(data), err
}

// @scenario "A WebSocket upgrade passes through every layer of the gateway"
func TestSocketUpgradeWorksThroughEveryWrapper(t *testing.T) {
	t.Parallel()
	g := newSocketGateway(t, &brokerWorld{}, nil)

	client, resp, err := g.dial("/v1/realtime?model=gpt-realtime", bearer(socketVirtualKey))
	require.NoError(t, err)
	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	assert.NotEmpty(t, resp.Header.Get("X-LangWatch-Gateway-Request-Id"))
	assert.Equal(t, "test", resp.Header.Get("X-LangWatch-Gateway-Version"))

	require.NoError(t, client.Write(context.Background(), websocket.MessageBinary, []byte{0, 1, 2, 3}))
	assert.Equal(t, "\x00\x01\x02\x03", g.vendor.frame())
	created := `{"type":"session.created"}`
	require.NoError(t, g.vendor.conn().Write(context.Background(), websocket.MessageText, []byte(created)))
	frame, err := readSocket(t, client)
	require.NoError(t, err)
	assert.Equal(t, created, frame, "the same bytes, not only the same JSON")

	booked := g.reservation()
	assert.Equal(t, domain.RealtimeKindRealtime, booked.Kind)
	assert.Equal(t, domain.RealtimeMeteringGateway, booked.Metering)
	assert.Equal(t, []string{"admit", "reserve"}[1], g.world.log[len(g.world.log)-1])
}

// @scenario "The relay swaps the virtual key for the provider key"
func TestRealtimeSocketSwapsTheKeyAndTheSubprotocol(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{config: domain.BundleConfig{ModelAliases: map[string]domain.ModelAlias{
		"voice": {ProviderID: domain.ProviderOpenAI, Model: "gpt-realtime-2.1"},
	}}}
	g := newSocketGateway(t, world, nil)

	client, _, err := g.dial("/v1/realtime?model=voice", nil,
		"realtime", "openai-insecure-api-key."+socketVirtualKey, "openai-organization.org_client")
	require.NoError(t, err)
	g.vendor.conn()

	assert.Equal(t, "realtime", client.Subprotocol(), "the key subprotocol is never echoed back")
	g.mu.Lock()
	assert.Equal(t, []string{socketVirtualKey}, g.tokens, "the key subprotocol authenticates the socket")
	g.mu.Unlock()

	g.vendor.mu.Lock()
	defer g.vendor.mu.Unlock()
	upstream := g.vendor.headers[0]
	assert.Equal(t, "Bearer sk-provider-openai", upstream.Get("Authorization"))
	assert.Equal(t, []string{"realtime"}, upstream.Values("Sec-WebSocket-Protocol"))
	assert.Equal(t, "/v1/realtime?model=gpt-realtime-2.1", g.vendor.urls[0], "the resolved model is what the vendor is asked for")
	assert.NotContains(t, g.vendor.requests[0], socketVirtualKey, "the virtual key is nowhere in the vendor handshake")
	assert.NotContains(t, g.vendor.requests[0], "org_client")
}

// @scenario "A Live socket's first frame decides the model"
func TestLiveSocketResolvesTheModelOfTheFirstFrame(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{config: domain.BundleConfig{
		ModelAliases: map[string]domain.ModelAlias{"live": {ProviderID: domain.ProviderOpenAI, Model: "gpt-live-1"}},
	}}
	g := newSocketGateway(t, world, nil)

	client, _, err := g.dial("/v1/live/sessions", bearer(socketVirtualKey))
	require.NoError(t, err)
	start := `{"type":"session.start","session":{"model":"live","instructions":"Be brief.","audio":{"format":{"type":"audio/pcm","rate":24000}}}}`
	require.NoError(t, client.Write(context.Background(), websocket.MessageText, []byte(start)))

	opening := g.vendor.frame()
	assert.Equal(t, "gpt-live-1", gjson.Get(opening, "session.model").String(), "the resolved model is written back")
	assert.Equal(t, "Be brief.", gjson.Get(opening, "session.instructions").String())
	assert.Equal(t, int64(24000), gjson.Get(opening, "session.audio.format.rate").Int())

	later := `{ "type":"session.update", "session":{"model":"live"} }`
	require.NoError(t, client.Write(context.Background(), websocket.MessageText, []byte(later)))
	assert.Equal(t, later, g.vendor.frame(), "every frame after the first is relayed untouched")

	g.vendor.mu.Lock()
	assert.Equal(t, "/v1/live/sessions", g.vendor.urls[0], "the vendor socket takes no query")
	assert.Equal(t, "Bearer sk-provider-openai", g.vendor.headers[0].Get("Authorization"))
	assert.NotContains(t, g.vendor.requests[0], socketVirtualKey)
	g.vendor.mu.Unlock()
	booked := g.reservation()
	assert.Equal(t, domain.RealtimeKindLive, booked.Kind)
	assert.Equal(t, "gpt-live-1", booked.Model)
	assert.Equal(t, "live", booked.RequestedModel)
}

// @scenario "A Live socket cannot delegate to a model the key does not allow"
func TestLiveSocketRefusesADelegatedModelOutsideTheAllowlist(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{config: domain.BundleConfig{AllowedModels: []string{"gpt-live-1", "gpt-6-luna"}}}
	g := newSocketGateway(t, world, nil)

	for name, tc := range map[string]struct{ frame, code string }{
		"delegated model outside the allowlist": {
			`{"type":"session.start","session":{"model":"gpt-live-1","delegation":{"type":"responses","responses":{"model":"gpt-6-astra"}}}}`,
			"model_not_allowed",
		},
		"session model outside the allowlist": {`{"type":"session.start","session":{"model":"gpt-live-9"}}`, "model_not_allowed"},
		"first frame is not session.start":    {`{"type":"session.update","session":{"model":"gpt-live-1"}}`, "bad_request"},
		"first frame names no model":          {`{"type":"session.start","session":{}}`, "bad_request"},
	} {
		client, _, err := g.dial("/v1/live/sessions", bearer(socketVirtualKey))
		require.NoError(t, err, name)
		require.NoError(t, client.Write(context.Background(), websocket.MessageText, []byte(tc.frame)), name)

		frame, err := readSocket(t, client)
		require.NoError(t, err, name)
		assert.Equal(t, "error", gjson.Get(frame, "type").String(), name)
		assert.Equal(t, tc.code, gjson.Get(frame, "error.code").String(), name+": "+frame)
		_, err = readSocket(t, client)
		assert.Equal(t, websocket.StatusPolicyViolation, websocket.CloseStatus(err), name)
	}
	assert.Zero(t, g.vendor.dialed(), "the vendor is never dialed")
	world.mu.Lock()
	assert.Empty(t, world.reserved, "nothing is booked")
	world.mu.Unlock()
	assert.Zero(t, g.manager.Supervised())
}

// @scenario "An ElevenLabs socket takes the virtual key in a header or the query"
func TestElevenLabsSocketsSwapTheKey(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		target   string
		header   http.Header
		upstream string
		kind     domain.RealtimeSessionKind
		model    string
	}{
		"stream-input, key in the xi-api-key query": {
			target:   "/v1/text-to-speech/voice_1/stream-input?model_id=eleven_flash_v2_5&xi-api-key=" + socketVirtualKey + "&output_format=pcm_16000&auto_mode=true",
			upstream: "/v1/text-to-speech/voice_1/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_16000&auto_mode=true",
			kind:     domain.RealtimeKindTTSSocket, model: "eleven_flash_v2_5",
		},
		"multi-stream-input, key in the authorization query": {
			target:   "/v1/text-to-speech/voice_1/multi-stream-input?authorization=Bearer%20" + socketVirtualKey + "&inactivity_timeout=60",
			upstream: "/v1/text-to-speech/voice_1/multi-stream-input?inactivity_timeout=60",
			kind:     domain.RealtimeKindTTSSocket, model: "eleven_multilingual_v2",
		},
		"dialog socket, key in the xi-api-key header": {
			target:   "/v1" + elevenLabsDialogSocketPath,
			header:   http.Header{"Xi-Api-Key": {socketVirtualKey}},
			upstream: "/v1" + elevenLabsDialogSocketPath,
			kind:     domain.RealtimeKindTTSSocket, model: "eleven_v3_conversational",
		},
		"realtime transcription, bearer key": {
			target:   "/v1/speech-to-text/realtime?audio_format=ulaw_8000&commit_strategy=vad",
			header:   bearer(socketVirtualKey),
			upstream: "/v1/speech-to-text/realtime?audio_format=ulaw_8000&commit_strategy=vad",
			kind:     domain.RealtimeKindSTTSocket, model: "scribe_v2_realtime",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			g := newSocketGateway(t, &brokerWorld{}, nil)

			client, _, err := g.dial(tc.target, tc.header)
			require.NoError(t, err)
			first := `{"text":" ","xi_api_key":"` + socketVirtualKey + `","xi-api-key":"` + socketVirtualKey + `"}`
			require.NoError(t, client.Write(context.Background(), websocket.MessageText, []byte(first)))

			assert.JSONEq(t, `{"text":" "}`, g.vendor.frame(), "the first frame's key fields are stripped")
			g.mu.Lock()
			assert.Equal(t, []string{socketVirtualKey}, g.tokens)
			g.mu.Unlock()
			g.vendor.mu.Lock()
			defer g.vendor.mu.Unlock()
			assert.Equal(t, tc.upstream, g.vendor.urls[0])
			assert.Equal(t, "sk-provider-11labs", g.vendor.headers[0].Get("xi-api-key"))
			assert.Empty(t, g.vendor.headers[0].Get("Authorization"))
			assert.NotContains(t, g.vendor.requests[0], socketVirtualKey, "the virtual key is nowhere in the vendor handshake")
			booked := g.reservation()
			assert.Equal(t, tc.kind, booked.Kind)
			assert.Equal(t, tc.model, booked.Model)
			assert.Equal(t, domain.RealtimeMeteringGateway, booked.Metering)
			assert.Equal(t, "cred-11labs", booked.ModelProviderID)
		})
	}
}

// @scenario "A socket for a model the key does not allow is refused before the upgrade"
func TestSocketModelOutsideTheAllowlistIsRefusedOverHTTP(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{config: domain.BundleConfig{AllowedModels: []string{"gpt-realtime-2.1"}}}
	g := newSocketGateway(t, world, nil)

	for _, target := range []string{
		"/v1/realtime?model=gpt-realtime-mini",
		"/v1/text-to-speech/voice_1/stream-input",
		"/v1/speech-to-text/realtime",
	} {
		_, resp, err := g.dial(target, bearer(socketVirtualKey))
		require.Error(t, err, target)
		require.NotNil(t, resp, target)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, target)
		assert.Equal(t, "model_not_allowed", resp.Header.Get("X-LangWatch-Handled-Error"), target)
	}
	_, resp, err := g.dial("/v1/realtime", bearer(socketVirtualKey))
	require.Error(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "a Realtime socket names its model in the query")
	assert.Zero(t, g.vendor.dialed())
	assert.Empty(t, world.reserved)
}

// @scenario "A full or draining gateway refuses an upgrade with 503"
func TestSocketUpgradeIsRefusedWhenTheGatewayCannotTakeIt(t *testing.T) {
	t.Parallel()

	t.Run("at the supervised-session cap", func(t *testing.T) {
		t.Parallel()
		world := &brokerWorld{}
		g := newSocketGateway(t, world, func(o *voicesession.Options) { o.MaxSessions = 1 })
		_, _, err := g.dial("/v1/realtime?model=gpt-realtime", bearer(socketVirtualKey))
		require.NoError(t, err)

		for _, target := range []string{"/v1/realtime?model=gpt-realtime", "/v1/live/sessions", "/v1/speech-to-text/realtime"} {
			_, resp, err := g.dial(target, bearer(socketVirtualKey))
			require.Error(t, err, target)
			assert.Equal(t, http.StatusServiceUnavailable, resp.StatusCode, target)
			assert.Equal(t, "5", resp.Header.Get("Retry-After"), target)
		}
		assert.Len(t, world.reserved, 1, "the refused sockets were never booked")
	})

	t.Run("while draining", func(t *testing.T) {
		t.Parallel()
		world := &brokerWorld{}
		g := newSocketGateway(t, world, nil)
		g.manager.BeginDrain()

		_, resp, err := g.dial("/v1/realtime?model=gpt-realtime", bearer(socketVirtualKey))
		require.Error(t, err)
		assert.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
		assert.Equal(t, "5", resp.Header.Get("Retry-After"))
		assert.Empty(t, world.log)
	})
}

// @scenario "A budget that is already spent refuses the upgrade"
func TestSocketUpgradeStopsAtAnExhaustedBudget(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{}
	budget := &mockBudget{precheckFn: func(context.Context, *domain.Bundle) (domain.BudgetDecision, error) {
		return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
	}}
	g := newSocketGateway(t, world, nil, app.WithBudget(budget))

	_, resp, err := g.dial("/v1/realtime?model=gpt-realtime", bearer(socketVirtualKey))

	require.Error(t, err)
	assert.Equal(t, http.StatusPaymentRequired, resp.StatusCode)
	assert.Empty(t, world.log)
	assert.Zero(t, g.vendor.dialed())
}

// @scenario "A key with no credential for the socket's vendor is refused"
func TestSocketNeedsACredentialOfTheRoutesVendor(t *testing.T) {
	t.Parallel()
	g := newSocketGateway(t, &brokerWorld{}, nil, app.WithAuth(&mockAuth{
		resolveFn: func(context.Context, string) (*domain.Bundle, error) {
			bundle := testBundle()
			bundle.Credentials = []domain.Credential{{ID: "cred-azure", ProviderID: domain.ProviderAzure, APIKey: "azure-key"}}
			return bundle, nil
		},
	}))

	for _, target := range []string{"/v1/realtime?model=gpt-realtime", "/v1/text-to-speech/voice_1/stream-input"} {
		_, resp, err := g.dial(target, bearer(socketVirtualKey))
		require.Error(t, err, target)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, target)
		assert.Equal(t, string(domain.ErrProviderNotBound), resp.Header.Get("X-LangWatch-Handled-Error"), target)
	}
	assert.Zero(t, g.vendor.dialed())
	assert.Empty(t, g.world.reserved)
}

func TestSocketRoutesRefuseARequestThatIsNoUpgrade(t *testing.T) {
	t.Parallel()
	g := newSocketGateway(t, &brokerWorld{}, nil)

	for _, target := range []string{"/v1/realtime?model=gpt-realtime", "/v1/live/sessions", "/v1" + elevenLabsDialogSocketPath} {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, g.server.URL+target, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+socketVirtualKey)
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, target)
	}
	// A key in the query string authenticates a socket and nothing else.
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet,
		g.server.URL+"/v1/models?xi-api-key="+socketVirtualKey, nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	assert.Empty(t, g.world.log)
}

func TestElevenLabsSocketQueryKeepsWhatTheClientWrote(t *testing.T) {
	t.Parallel()
	assert.Empty(t, elevenLabsSocketQuery("", ""))
	assert.Equal(t, "output_format=pcm_16000&keyterms=a%20b&keyterms=c",
		elevenLabsSocketQuery("xi-api-key=vk&output_format=pcm_16000&keyterms=a%20b&authorization=Bearer+vk&keyterms=c", ""))
	assert.Equal(t, "model_id=eleven_flash_v2_5&seed=1",
		elevenLabsSocketQuery("model_id=fast&seed=1", "eleven_flash_v2_5"))
	assert.NotContains(t, elevenLabsSocketQuery("xi_api_key=vk&a=1", ""), "vk")
}
