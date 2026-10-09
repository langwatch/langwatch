package httpapi

// The HTTP boundary of the brokered voice calls: what is booked, in what
// order, and what the caller gets back.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/voicesession"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// brokerWorld is everything a brokered call touches, with one ordered log of
// what happened.
type brokerWorld struct {
	mu           sync.Mutex
	log          []string
	reserved     []domain.RealtimeReservation
	correlated   []domain.RealtimeCorrelation
	released     []domain.RealtimeRelease
	dispatched   []domain.Request
	credentials  []domain.Credential
	started      []domain.BrokeredVoiceSession
	abandoned    []domain.BrokeredVoiceSession
	slotReleases int

	reserveErr   error
	correlateErr error
	answer       func(req *domain.Request) (*domain.Response, error)
	config       domain.BundleConfig
}

func (b *brokerWorld) note(event string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.log = append(b.log, event)
}

func (b *brokerWorld) Reserve(_ context.Context, r domain.RealtimeReservation) error {
	b.note("reserve")
	if b.reserveErr != nil {
		return b.reserveErr
	}
	b.reserved = append(b.reserved, r)
	return nil
}

func (b *brokerWorld) Correlate(_ context.Context, c domain.RealtimeCorrelation) error {
	b.note("correlate")
	b.correlated = append(b.correlated, c)
	return b.correlateErr
}

func (b *brokerWorld) Release(_ context.Context, r domain.RealtimeRelease) error {
	b.note("release")
	b.released = append(b.released, r)
	return nil
}

func (b *brokerWorld) ReportUsage(context.Context, domain.RealtimeUsageReport) (domain.RealtimeUsageReceipt, error) {
	return domain.RealtimeUsageReceipt{}, nil
}

func (b *brokerWorld) Admit(context.Context, domain.RealtimeSessionKind) (domain.VoiceSlot, error) {
	b.note("admit")
	return brokerSlot{b}, nil
}

type brokerSlot struct{ world *brokerWorld }

func (s brokerSlot) Start(call domain.BrokeredVoiceSession) {
	s.world.note("supervise")
	s.world.started = append(s.world.started, call)
}

func (s brokerSlot) Abandon(_ context.Context, call domain.BrokeredVoiceSession) {
	s.world.note("abandon")
	s.world.abandoned = append(s.world.abandoned, call)
}

func (s brokerSlot) Release() { s.world.slotReleases++ }

func liveAnswer(req *domain.Request) (*domain.Response, error) {
	return &domain.Response{
		StatusCode:             http.StatusCreated,
		RealtimeConversationID: "live_123",
		Body: []byte(`{"session":{"id":"live_123"},"transport":{"type":"webrtc","sdp":"v=0 answer"},` +
			`"langwatch":{"session_id":"` + req.RealtimeSession.SessionID + `"}}`),
	}, nil
}

func callAnswer(*domain.Request) (*domain.Response, error) {
	return &domain.Response{
		StatusCode:             http.StatusCreated,
		RealtimeConversationID: "rtc_456",
		Body:                   []byte("v=0 answer"),
		Headers:                map[string]string{"Content-Type": "application/sdp", "Location": "/v1/realtime/calls/rtc_456"},
	}, nil
}

// brokerRouter serves the broker routes over world, with supervisor as the
// call supervisor (world itself when nil).
func brokerRouter(world *brokerWorld, supervisor app.VoiceSupervisor, extra ...app.Option) http.Handler {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error) {
			world.note("vendor")
			copied := *req
			copied.Body = append([]byte(nil), req.Body...)
			world.dispatched = append(world.dispatched, copied)
			world.credentials = append(world.credentials, cred)
			return world.answer(req)
		},
	}
	auth := &mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
		bundle := testBundle()
		bundle.Credentials = append(bundle.Credentials, domain.Credential{
			ID: "cred-anthropic", ProviderID: domain.ProviderAnthropic, APIKey: "sk-ant-test",
		})
		config := world.config
		config.Fallback = domain.FallbackConfig{MaxAttempts: 1}
		bundle.Config = config
		return bundle, nil
	}}
	if supervisor == nil {
		supervisor = world
	}
	opts := []app.Option{
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithRealtimeSessions(world),
		app.WithVoiceSupervisor(supervisor),
		app.WithLogger(zap.NewNop()),
	}
	return buildRouter(append(opts, extra...)...)
}

func postBroker(router http.Handler, target, contentType string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, target, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func postLive(router http.Handler, body string) *httptest.ResponseRecorder {
	return postBroker(router, "/v1/live/sessions", "application/json", []byte(body))
}

const liveOffer = `{"session":{"model":"gpt-live","voice":"marin"},"transport":{"type":"webrtc","sdp":"v=0 offer"}}`

// @scenario "A Live session is booked before the provider is called"
func TestLiveSessionIsBookedBeforeTheVendorCall(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: liveAnswer}

	rec := postLive(brokerRouter(world, nil), liveOffer)

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Equal(t, []string{"admit", "reserve", "vendor", "correlate", "supervise"}, world.log)
	require.Len(t, world.reserved, 1)
	booking := world.reserved[0]
	assert.Equal(t, domain.RealtimeKindLive, booking.Kind)
	assert.Equal(t, domain.RealtimeMeteringGateway, booking.Metering)
	assert.Equal(t, domain.RealtimeVendorOpenAI, booking.Vendor)
	assert.Equal(t, "cred-1", booking.ModelProviderID, "the OpenAI credential is pinned")
	assert.Equal(t, "gpt-live", booking.Model)
	assert.Equal(t, domain.ProviderOpenAI, world.credentials[0].ProviderID)
	assert.Zero(t, world.slotReleases, "the slot now belongs to the supervisor")
}

// @scenario "A Live answer is returned verbatim with the gateway session id"
func TestLiveAnswerIsReturnedWithTheSessionID(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: liveAnswer}

	rec := postLive(brokerRouter(world, nil), liveOffer)

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	sessionID := rec.Header().Get("X-LangWatch-Session-Id")
	require.NotEmpty(t, sessionID)
	body := gjson.ParseBytes(rec.Body.Bytes())
	assert.Equal(t, "live_123", body.Get("session.id").String())
	assert.Equal(t, "v=0 answer", body.Get("transport.sdp").String())
	assert.Equal(t, sessionID, body.Get("langwatch.session_id").String())

	require.Len(t, world.correlated, 1)
	assert.Equal(t, "live_123", world.correlated[0].VendorConversationID)
	assert.Equal(t, sessionID, world.correlated[0].SessionID)
	require.Len(t, world.started, 1)
	assert.Equal(t, "live_123", world.started[0].VendorSessionID)
	assert.Equal(t, domain.RealtimeKindLive, world.started[0].Kind)
	assert.Equal(t, sessionID, world.started[0].SessionID)
	assert.Equal(t, "sk-test", world.started[0].Credential.APIKey)
	assert.Equal(t, "vk-test", world.started[0].Bundle.VirtualKeyID)
}

// @scenario "A Live session the provider refuses is released"
func TestLiveSessionTheVendorRefusesIsReleased(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: func(*domain.Request) (*domain.Response, error) {
		return &domain.Response{
			StatusCode: http.StatusBadRequest,
			Body:       []byte(`{"error":{"message":"Invalid SDP offer","type":"invalid_request_error"}}`),
		}, nil
	}}

	rec := postLive(brokerRouter(world, nil), liveOffer)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "Invalid SDP offer")
	assert.Equal(t, []string{"admit", "reserve", "vendor", "release"}, world.log)
	require.Len(t, world.released, 1)
	assert.Equal(t, "mint_failed", world.released[0].Reason)
	assert.Equal(t, 1, world.slotReleases, "a call that never started gives its slot back")
	assert.Empty(t, world.started)
}

// @scenario "A Live session cannot delegate to a model the key does not allow"
func TestLiveDelegatedModelMustPassTheAllowlist(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: liveAnswer, config: domain.BundleConfig{AllowedModels: []string{"gpt-live", "gpt-6-luna"}}}
	router := brokerRouter(world, nil)

	refused := postLive(router, `{"session":{"model":"gpt-live","delegation":{"responses":{"model":"gpt-6-astra"}}},`+
		`"transport":{"type":"webrtc","sdp":"v=0 offer"}}`)

	assert.Equal(t, http.StatusBadRequest, refused.Code, refused.Body.String())
	assert.Equal(t, "model_not_allowed", gjson.GetBytes(refused.Body.Bytes(), "error.code").String())
	assert.Contains(t, refused.Body.String(), "gpt-6-astra")
	assert.Empty(t, world.log, "nothing is booked and the vendor is not called")

	allowed := postLive(router, `{"session":{"model":"gpt-live","delegation":{"responses":{"model":"gpt-6-luna"}}},`+
		`"transport":{"type":"webrtc","sdp":"v=0 offer"}}`)
	assert.Equal(t, http.StatusCreated, allowed.Code, allowed.Body.String())
}

// @scenario "A Live session over a transport other than WebRTC is refused"
func TestLiveSessionOverAnotherTransportIsRefused(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: liveAnswer}
	router := brokerRouter(world, nil)

	for name, body := range map[string]string{
		"websocket":    `{"session":{"model":"gpt-live"},"transport":{"type":"websocket"}}`,
		"no transport": `{"session":{"model":"gpt-live"}}`,
		"no offer":     `{"session":{"model":"gpt-live"},"transport":{"type":"webrtc"}}`,
		"not json":     `v=0`,
	} {
		rec := postLive(router, body)
		assert.Equal(t, http.StatusBadRequest, rec.Code, name)
	}
	assert.Empty(t, world.log)
}

// @scenario "A key at its open session cap gets no brokered call"
func TestBrokeredCallOverTheKeyCapNeverReachesTheVendor(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{
		answer:     liveAnswer,
		reserveErr: herr.New(context.Background(), domain.ErrRealtimeSessionLimit, herr.M{"message": "limit reached"}),
	}

	rec := postLive(brokerRouter(world, nil), liveOffer)

	assert.Equal(t, http.StatusTooManyRequests, rec.Code, rec.Body.String())
	assert.Equal(t, []string{"admit", "reserve"}, world.log)
	assert.Equal(t, 1, world.slotReleases)
}

// @scenario "A brokered call that cannot be recorded is ended at the provider"
func TestBrokeredCallThatCannotBeRecordedIsAbandoned(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{
		answer:       liveAnswer,
		correlateErr: herr.New(context.Background(), domain.ErrRealtimeRegistryUnavailable, nil),
	}

	rec := postLive(brokerRouter(world, nil), liveOffer)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, rec.Body.String())
	assert.Equal(t, []string{"admit", "reserve", "vendor", "correlate", "abandon", "release"}, world.log)
	require.Len(t, world.abandoned, 1)
	assert.Equal(t, "live_123", world.abandoned[0].VendorSessionID, "the vendor call exists and must be hung up")
	assert.NotContains(t, rec.Body.String(), "v=0 answer")
}

// @scenario "A budget that is already spent refuses a brokered call"
func TestBrokeredCallStopsAtAnExhaustedBudget(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: liveAnswer}
	budget := &mockBudget{precheckFn: func(context.Context, *domain.Bundle) (domain.BudgetDecision, error) {
		return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
	}}

	rec := postLive(brokerRouter(world, nil, app.WithBudget(budget)), liveOffer)

	assert.Equal(t, http.StatusPaymentRequired, rec.Code, rec.Body.String())
	assert.Empty(t, world.log)
}

func realtimeCallForm(t *testing.T, session string) (string, []byte) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, part := range [][3]string{
		{"sdp", "application/sdp", "v=0 offer"},
		{"session", "application/json", session},
	} {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", `form-data; name="`+part[0]+`"`)
		header.Set("Content-Type", part[1])
		w, err := writer.CreatePart(header)
		require.NoError(t, err)
		_, err = w.Write([]byte(part[2]))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	return writer.FormDataContentType(), body.Bytes()
}

// @scenario "A Realtime call is brokered from the multipart form"
func TestRealtimeCallFromTheMultipartForm(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: callAnswer}
	contentType, form := realtimeCallForm(t,
		`{"type":"realtime","model":"gpt-realtime","audio":{"input":{"transcription":{"model":"gpt-4o-transcribe"}}}}`)

	rec := postBroker(brokerRouter(world, nil), "/v1/realtime/calls", contentType, form)

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Equal(t, "v=0 answer", rec.Body.String(), "the SDP answer is returned byte for byte")
	assert.Equal(t, "application/sdp", rec.Header().Get("Content-Type"))
	assert.Equal(t, "/v1/realtime/calls/rtc_456", rec.Header().Get("Location"))
	sessionID := rec.Header().Get("X-LangWatch-Session-Id")
	assert.NotEmpty(t, sessionID)

	assert.Equal(t, []string{"admit", "reserve", "vendor", "correlate", "supervise"}, world.log)
	booking := world.reserved[0]
	assert.Equal(t, domain.RealtimeKindRealtime, booking.Kind)
	assert.Equal(t, domain.RealtimeMeteringGateway, booking.Metering)
	assert.Equal(t, "gpt-realtime", booking.Model)
	assert.Equal(t, "openai/gpt-4o-transcribe", booking.TranscriptionModel)
	assert.Equal(t, "rtc_456", world.correlated[0].VendorConversationID)
	assert.Equal(t, "rtc_456", world.started[0].VendorSessionID)
	assert.Equal(t, domain.RealtimeKindRealtime, world.started[0].Kind)

	sent := world.dispatched[0]
	assert.Equal(t, "v=0 offer", string(sent.RealtimeSession.SDP))
	assert.Equal(t, "gpt-realtime", gjson.GetBytes(sent.Body, "session.model").String())
	assert.Equal(t, "gpt-4o-transcribe", gjson.GetBytes(sent.Body, "session.audio.input.transcription.model").String())
}

// @scenario "A Realtime call is brokered from a raw SDP offer"
func TestRealtimeCallFromARawSDPOffer(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: callAnswer}

	rec := postBroker(brokerRouter(world, nil), "/v1/realtime/calls?model=openai/gpt-realtime", "application/sdp", []byte("v=0 offer"))

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Equal(t, "v=0 answer", rec.Body.String())
	assert.Equal(t, "/v1/realtime/calls/rtc_456", rec.Header().Get("Location"))
	sent := world.dispatched[0]
	assert.Equal(t, "v=0 offer", string(sent.RealtimeSession.SDP))
	assert.Equal(t, "gpt-realtime", gjson.GetBytes(sent.Body, "session.model").String(),
		"the resolved model is written back for the vendor")
	assert.Equal(t, "realtime", gjson.GetBytes(sent.Body, "session.type").String())
	assert.Equal(t, "gpt-realtime", world.reserved[0].Model)
}

func TestRealtimeCallRefusesAnOfferItCannotRead(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: callAnswer}
	router := brokerRouter(world, nil)
	contentType, noSession := realtimeCallForm(t, `"not an object"`)

	for name, rec := range map[string]*httptest.ResponseRecorder{
		"json body":      postBroker(router, "/v1/realtime/calls", "application/json", []byte(`{"sdp":"v=0"}`)),
		"empty offer":    postBroker(router, "/v1/realtime/calls?model=gpt-realtime", "application/sdp", nil),
		"raw, no model":  postBroker(router, "/v1/realtime/calls", "application/sdp", []byte("v=0 offer")),
		"bad session":    postBroker(router, "/v1/realtime/calls", contentType, noSession),
		"broken form":    postBroker(router, "/v1/realtime/calls", "multipart/form-data; boundary=x", []byte("--x\r\nbroken")),
		"no auth at all": httptest.NewRecorder(),
	} {
		if name == "no auth at all" {
			req := httptest.NewRequest(http.MethodPost, "/v1/realtime/calls", strings.NewReader("v=0"))
			router.ServeHTTP(rec, req)
			assert.Equal(t, http.StatusUnauthorized, rec.Code, name)
			continue
		}
		assert.Equal(t, http.StatusBadRequest, rec.Code, name+": "+rec.Body.String())
	}
	assert.Empty(t, world.log)
}

// @scenario "A full gateway refuses a new call before booking it"
func TestFullGatewayAnswers503BeforeBooking(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: liveAnswer}
	manager := voicesession.NewManager(voicesession.Options{Registry: world, MaxSessions: 1, DrainBudget: time.Hour})
	_, err := manager.Admit(context.Background(), domain.RealtimeKindLive)
	require.NoError(t, err)

	rec := postLive(brokerRouter(world, manager), liveOffer)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, rec.Body.String())
	assert.Equal(t, "5", rec.Header().Get("Retry-After"))
	assert.Equal(t, "voice_broker_unavailable", gjson.GetBytes(rec.Body.Bytes(), "error.code").String())
	assert.Empty(t, world.log, "nothing was booked and the vendor was not called")
}

// @scenario "A draining gateway refuses a new call"
func TestDrainingGatewayAnswers503(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: callAnswer}
	manager := voicesession.NewManager(voicesession.Options{Registry: world, DrainBudget: time.Hour})
	manager.BeginDrain()

	rec := postBroker(brokerRouter(world, manager), "/v1/realtime/calls?model=gpt-realtime", "application/sdp", []byte("v=0 offer"))

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, rec.Body.String())
	assert.Equal(t, "5", rec.Header().Get("Retry-After"))
	assert.Empty(t, world.log)
}

func TestBrokerRoutesNeedACallSupervisor(t *testing.T) {
	t.Parallel()
	world := &brokerWorld{answer: liveAnswer}
	router := buildRouter(
		app.WithAuth(&mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) { return testBundle(), nil }}),
		app.WithProviders(&mockProvider{}),
		app.WithModels(modelresolver.New()),
		app.WithRealtimeSessions(world),
		app.WithLogger(zap.NewNop()),
	)

	rec := postLive(router, liveOffer)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, rec.Body.String())
	assert.Empty(t, world.log)
}
