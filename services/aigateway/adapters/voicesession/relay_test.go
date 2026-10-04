package voicesession

// The WebSocket relay: frames carried both ways unchanged, usage read off the
// vendor's events, and the rules that close a relayed socket.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// relayFrame is one message as a socket carried it.
type relayFrame struct {
	kind websocket.MessageType
	data []byte
}

// relayVendor is the vendor's side of a relayed socket.
type relayVendor struct {
	t      *testing.T
	server *httptest.Server

	mu       sync.Mutex
	requests []*http.Request
	refuse   int
	conns    chan *websocket.Conn
	frames   chan relayFrame
	closed   chan error
}

func newRelayVendor(t *testing.T) *relayVendor {
	t.Helper()
	v := &relayVendor{
		t:      t,
		conns:  make(chan *websocket.Conn, 4),
		frames: make(chan relayFrame, 256),
		closed: make(chan error, 4),
	}
	v.server = httptest.NewServer(http.HandlerFunc(v.serve))
	t.Cleanup(v.server.Close)
	return v
}

func (v *relayVendor) serve(w http.ResponseWriter, r *http.Request) {
	v.mu.Lock()
	v.requests = append(v.requests, r.Clone(context.Background()))
	refuse := v.refuse
	v.mu.Unlock()
	if refuse != 0 {
		w.WriteHeader(refuse)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"realtime"}})
	if err != nil {
		return
	}
	conn.SetReadLimit(relayReadLimit)
	v.conns <- conn
	for {
		kind, data, err := conn.Read(context.Background())
		if err != nil {
			v.closed <- err
			return
		}
		v.frames <- relayFrame{kind: kind, data: data}
	}
}

func (v *relayVendor) conn() *websocket.Conn {
	v.t.Helper()
	select {
	case conn := <-v.conns:
		return conn
	case <-time.After(5 * time.Second):
		v.t.Fatal("the relay never dialed the vendor")
		return nil
	}
}

func (v *relayVendor) frame() relayFrame {
	v.t.Helper()
	select {
	case frame := <-v.frames:
		return frame
	case <-time.After(5 * time.Second):
		v.t.Fatal("the vendor received no frame")
		return relayFrame{}
	}
}

func (v *relayVendor) closeError() error {
	v.t.Helper()
	select {
	case err := <-v.closed:
		return err
	case <-time.After(5 * time.Second):
		v.t.Fatal("the vendor socket was never closed")
		return nil
	}
}

func (v *relayVendor) request() *http.Request {
	v.mu.Lock()
	defer v.mu.Unlock()
	require.NotEmpty(v.t, v.requests)
	return v.requests[0]
}

// relayRig is a relay between a test client and a fake vendor, with the
// control plane and the booking faked.
type relayRig struct {
	t        *testing.T
	vendor   *relayVendor
	registry *fakeRegistry
	metrics  *fakeMetrics
	manager  *Manager
	gateway  *httptest.Server

	mu       sync.Mutex
	released []string
	opened   int
	refusals []error
	// shape edits the call a test relays.
	shape func(*RelayCall)
	kind  domain.RealtimeSessionKind
}

func newRelayRig(t *testing.T, kind domain.RealtimeSessionKind, configure func(*Options)) *relayRig {
	t.Helper()
	r := &relayRig{t: t, vendor: newRelayVendor(t), registry: newFakeRegistry(), metrics: newFakeMetrics(), kind: kind}
	opts := Options{
		Registry: r.registry,
		Vendor:   NewOpenAIVendor(r.vendor.server.Client(), nil),
		RelayEndpoint: func(cred domain.Credential, path string) string {
			return cred.Extra["base_url"] + path
		},
		Metrics:     r.metrics,
		DrainBudget: time.Hour,
		Timing:      fastTiming(),
	}
	if configure != nil {
		configure(&opts)
	}
	r.manager = NewManager(opts)
	r.gateway = httptest.NewServer(http.HandlerFunc(r.serve))
	t.Cleanup(r.gateway.Close)
	return r
}

func (r *relayRig) serve(w http.ResponseWriter, req *http.Request) {
	slot, err := r.manager.Admit(req.Context(), r.kind)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	header := http.Header{}
	header.Set("Authorization", "Bearer "+providerKey)
	call := RelayCall{
		Ticket: &domain.VoiceRelayTicket{
			Session: domain.BrokeredVoiceSession{
				SessionID: "req_1",
				Kind:      r.kind,
				Credential: domain.Credential{
					ID: "cred_1", ProviderID: domain.ProviderOpenAI, APIKey: providerKey,
					Extra: map[string]string{"base_url": r.vendor.server.URL},
				},
				Bundle:    &domain.Bundle{VirtualKeyID: "vk_1", ProjectID: "proj_1"},
				StartedAt: time.Now(),
			},
			Slot: slot,
			Opened: func() {
				r.mu.Lock()
				r.opened++
				r.mu.Unlock()
			},
			Release: func(_ context.Context, reason string) {
				r.mu.Lock()
				r.released = append(r.released, reason)
				r.mu.Unlock()
				slot.Release()
			},
		},
		Path:               "/v1/realtime",
		RawQuery:           "model=gpt-realtime",
		Header:             header,
		Subprotocols:       []string{"realtime"},
		ClientSubprotocols: []string{"realtime"},
	}
	if r.shape != nil {
		r.shape(&call)
	}
	if err := r.manager.Relay(w, req, call); err != nil {
		r.mu.Lock()
		r.refusals = append(r.refusals, err)
		r.mu.Unlock()
		w.WriteHeader(http.StatusBadGateway)
	}
}

// dial opens the client's side and answers it with the vendor's.
func (r *relayRig) dial() (*websocket.Conn, *websocket.Conn) {
	r.t.Helper()
	client, _, err := websocket.Dial(context.Background(), r.gateway.URL, &websocket.DialOptions{
		Subprotocols: []string{"realtime"},
	})
	require.NoError(r.t, err)
	client.SetReadLimit(relayReadLimit)
	r.t.Cleanup(func() { _ = client.CloseNow() })
	return client, r.vendor.conn()
}

func readFrame(t *testing.T, conn *websocket.Conn) relayFrame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	kind, data, err := conn.Read(ctx)
	require.NoError(t, err)
	return relayFrame{kind: kind, data: data}
}

func readClose(t *testing.T, conn *websocket.Conn) websocket.CloseError {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		_, _, err := conn.Read(ctx)
		if err == nil {
			continue
		}
		var closed websocket.CloseError
		require.ErrorAs(t, err, &closed, "the socket ended without a close frame")
		return closed
	}
}

func send(t *testing.T, conn *websocket.Conn, kind websocket.MessageType, data []byte) {
	t.Helper()
	require.NoError(t, conn.Write(context.Background(), kind, data))
}

// @scenario "The relay carries every frame unchanged in both directions"
func TestRelayCarriesFramesUnchanged(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindRealtime, nil)
	client, vendor := r.dial()

	audio := make([]byte, 4096)
	_, _ = rand.Read(audio)
	large := make([]byte, relayInlineBytes+300_000)
	_, _ = rand.Read(large)
	text := []byte(`{ "type" : "response.create",  "response":{"instructions":"Say hi é"} }`)
	frames := []relayFrame{
		{websocket.MessageText, text},
		{websocket.MessageBinary, audio},
		{websocket.MessageBinary, large},
		{websocket.MessageText, []byte(`not json at all`)},
	}

	for _, frame := range frames {
		send(t, client, frame.kind, frame.data)
		got := r.vendor.frame()
		assert.Equal(t, frame.kind, got.kind)
		assert.True(t, bytes.Equal(frame.data, got.data), "client to vendor bytes differ")
	}
	for _, frame := range frames {
		send(t, vendor, frame.kind, frame.data)
		got := readFrame(t, client)
		assert.Equal(t, frame.kind, got.kind)
		assert.True(t, bytes.Equal(frame.data, got.data), "vendor to client bytes differ")
	}
	assert.Equal(t, "realtime", client.Subprotocol())
}

// @scenario "The vendor socket of a relay carries the provider key"
func TestRelayDialsTheVendorWithTheProviderKey(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindRealtime, nil)
	r.dial()

	upstream := r.vendor.request()
	assert.Equal(t, "Bearer "+providerKey, upstream.Header.Get("Authorization"))
	assert.Equal(t, "/v1/realtime?model=gpt-realtime", upstream.URL.RequestURI())
	assert.Equal(t, "realtime", upstream.Header.Get("Sec-WebSocket-Protocol"))
	require.Eventually(t, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.opened == 1
	}, 5*time.Second, 5*time.Millisecond)
	r.mu.Lock()
	defer r.mu.Unlock()
	assert.Empty(t, r.released)
}

// @scenario "Each relayed Realtime response is one report"
func TestRelayReportsEachRealtimeResponse(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindRealtime, nil)
	client, vendor := r.dial()

	for _, id := range []string{"resp_1", "resp_2", "resp_3"} {
		send(t, vendor, websocket.MessageText, []byte(`{"type":"response.output_audio.delta","delta":"QUJD"}`))
		send(t, vendor, websocket.MessageText, []byte(responseDone(id)))
		readFrame(t, client)
		assert.JSONEq(t, responseDone(id), string(readFrame(t, client).data), "the client still gets the event")
	}
	reports := r.registry.awaitReports(t, 3)
	require.NoError(t, client.Close(websocket.StatusNormalClosure, ""))
	assert.Equal(t, ReasonClientClosed, r.metrics.awaitEnded(t))

	var text, audioIn, audioOut, cached int
	for i, id := range []string{"resp_1", "resp_2", "resp_3"} {
		report := reports[i]
		assert.Equal(t, id, report.ReportKey)
		assert.Equal(t, domain.RealtimeMeteringGateway, report.Source)
		assert.False(t, report.Final)
		text += report.Usage.PromptTokens + report.Usage.CompletionTokens
		audioIn += report.Usage.InputAudioTokens
		audioOut += report.Usage.OutputAudioTokens
		cached += report.Usage.CacheReadTokens
	}
	assert.Equal(t, 3*(119+30), text)
	assert.Equal(t, 3*13, audioIn)
	assert.Equal(t, 3*91, audioOut)
	assert.Equal(t, 3*64, cached)

	final := r.registry.awaitReports(t, 4)[3]
	assert.True(t, final.Final, "the close is reported once the socket ends")
	assert.Nil(t, final.Usage)
}

// @scenario "A relayed socket over budget gets an error frame and close 1008"
func TestRelayBudgetBreachSendsTheErrorFrameThenCloses(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindRealtime, nil)
	r.registry.receipt = func(n int, _ domain.RealtimeUsageReport) domain.RealtimeUsageReceipt {
		receipt := domain.RealtimeUsageReceipt{Status: domain.RealtimeReportRecorded}
		if n == 2 {
			receipt.Budget = domain.RealtimeBudgetState{Exceeded: true, Scope: "virtual_key", BudgetID: "budget_1"}
		}
		return receipt
	}
	client, vendor := r.dial()

	send(t, vendor, websocket.MessageText, []byte(responseDone("resp_1")))
	assert.JSONEq(t, responseDone("resp_1"), string(readFrame(t, client).data))
	send(t, vendor, websocket.MessageText, []byte(responseDone("resp_2")))
	assert.JSONEq(t, responseDone("resp_2"), string(readFrame(t, client).data))

	failure := readFrame(t, client)
	assert.Equal(t, websocket.MessageText, failure.kind)
	assert.Equal(t, "error", gjson.GetBytes(failure.data, "type").String())
	assert.Equal(t, "budget_exceeded", gjson.GetBytes(failure.data, "error.type").String())
	assert.Equal(t, "budget_exceeded", gjson.GetBytes(failure.data, "error.code").String())
	assert.NotEmpty(t, gjson.GetBytes(failure.data, "error.message").String())

	closed := readClose(t, client)
	assert.Equal(t, websocket.StatusPolicyViolation, closed.Code)
	assert.Equal(t, ReasonBudgetExceeded, closed.Reason)
	require.Error(t, r.vendor.closeError(), "the vendor socket is closed too")
	assert.Equal(t, ReasonBudgetExceeded, r.metrics.awaitEnded(t))
	assert.True(t, r.registry.awaitReports(t, 3)[2].Final)
}

// @scenario "A relayed socket closes when its key is revoked"
func TestRelayClosesWhenTheKeyIsRevoked(t *testing.T) {
	t.Parallel()
	var revoked atomic.Bool
	keys := &fakeKeys{held: func(b *domain.Bundle) (domain.HeldKey, error) {
		return domain.HeldKey{Bundle: b, Revoked: revoked.Load()}, nil
	}}
	r := newRelayRig(t, domain.RealtimeKindRealtime, func(o *Options) { o.Keys = keys })
	client, vendor := r.dial()
	send(t, vendor, websocket.MessageText, []byte(`{"type":"session.created"}`))
	readFrame(t, client)

	revoked.Store(true)
	started := time.Now()
	closed := readClose(t, client)

	assert.Equal(t, websocket.StatusPolicyViolation, closed.Code)
	assert.Equal(t, ReasonKeyRevoked, closed.Reason)
	assert.Less(t, time.Since(started), time.Second, "within one refresh of the key")
	assert.Equal(t, ReasonKeyRevoked, r.metrics.awaitEnded(t))
}

// @scenario "A close on one side of a relay reaches the other with its code"
func TestRelayPassesCloseCodesOn(t *testing.T) {
	t.Parallel()

	t.Run("vendor to client", func(t *testing.T) {
		t.Parallel()
		r := newRelayRig(t, domain.RealtimeKindRealtime, nil)
		client, vendor := r.dial()

		go func() { _ = vendor.Close(websocket.StatusCode(4001), "session_expired") }()
		closed := readClose(t, client)

		assert.Equal(t, websocket.StatusCode(4001), closed.Code)
		assert.Equal(t, "session_expired", closed.Reason)
		assert.Equal(t, ReasonVendorClosed, r.metrics.awaitEnded(t))
	})

	t.Run("client to vendor", func(t *testing.T) {
		t.Parallel()
		r := newRelayRig(t, domain.RealtimeKindRealtime, nil)
		client, _ := r.dial()

		go func() { _ = client.Close(websocket.StatusCode(3000), "done here") }()
		var closed websocket.CloseError
		require.ErrorAs(t, r.vendor.closeError(), &closed)

		assert.Equal(t, websocket.StatusCode(3000), closed.Code)
		assert.Equal(t, "done here", closed.Reason)
		assert.Equal(t, ReasonClientClosed, r.metrics.awaitEnded(t))
	})
}

// @scenario "A vendor that refuses the socket releases the booking"
func TestRelayReleasesTheBookingWhenTheDialFails(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindRealtime, nil)
	r.vendor.refuse = http.StatusUnauthorized

	_, resp, err := websocket.Dial(context.Background(), r.gateway.URL, nil)

	require.Error(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, http.StatusBadGateway, resp.StatusCode, "the client is refused over HTTP, before any upgrade")
	r.mu.Lock()
	defer r.mu.Unlock()
	assert.Equal(t, []string{"dial_failed"}, r.released)
	require.Len(t, r.refusals, 1)
	assert.True(t, herr.IsCode(r.refusals[0], domain.ErrProviderError))
	assert.NotContains(t, r.refusals[0].Error(), providerKey)
	assert.Zero(t, r.manager.Supervised())
	assert.Empty(t, r.registry.snapshot())
}

// @scenario "A draining gateway closes relayed sockets with 1012"
func TestRelayDrainClosesWithServiceRestart(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindRealtime, func(o *Options) { o.DrainBudget = 50 * time.Millisecond })
	client, vendor := r.dial()
	send(t, vendor, websocket.MessageText, []byte(responseDone("resp_1")))
	readFrame(t, client)
	r.registry.awaitReports(t, 1)

	r.manager.BeginDrain()
	_, err := r.manager.Admit(context.Background(), domain.RealtimeKindRealtime)
	require.Error(t, err, "no new socket is admitted while draining")
	require.Error(t, r.manager.Available(context.Background()))

	// The socket keeps relaying until the drain budget runs out.
	send(t, client, websocket.MessageText, []byte(`{"type":"input_audio_buffer.commit"}`))
	assert.JSONEq(t, `{"type":"input_audio_buffer.commit"}`, string(r.vendor.frame().data))

	closed := readClose(t, client)
	assert.Equal(t, websocket.StatusServiceRestart, closed.Code)
	assert.Equal(t, "service_restart", closed.Reason)
	assert.Equal(t, ReasonDrain, r.metrics.awaitEnded(t))
	reports := r.registry.awaitReports(t, 2)
	assert.True(t, reports[1].Final, "the final report is sent before the process exits")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(t, r.manager.Stop(ctx))
	assert.Zero(t, r.manager.Supervised())
}

// @scenario "A relayed Live socket reports cumulative seconds as deltas"
func TestRelayLiveReportsSecondsAndAsksTheVendorToClose(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindLive, nil)
	r.shape = func(call *RelayCall) {
		call.Path, call.RawQuery = "/v1/live/sessions", ""
		call.Opening = []byte(`{"type":"session.start","session":{"model":"gpt-live-1"}}`)
	}
	client, vendor := r.dial()

	assert.Equal(t, "/v1/live/sessions", r.vendor.request().URL.RequestURI())
	assert.JSONEq(t, `{"type":"session.start","session":{"model":"gpt-live-1"}}`, string(r.vendor.frame().data))

	send(t, vendor, websocket.MessageText, []byte(`{"type":"session.usage.updated","usage":{"seconds":12}}`))
	readFrame(t, client)
	first := r.registry.awaitReports(t, 1)[0]
	assert.Equal(t, "u-12", first.ReportKey)
	assert.InDelta(t, 12.0, first.Usage.AudioSeconds, 0.001)

	// The client leaves without closing its session: the gateway asks the
	// vendor to, and the final duration it states is what is billed.
	require.NoError(t, client.CloseNow())
	assert.JSONEq(t, `{"type":"session.close"}`, string(r.vendor.frame().data))
	send(t, vendor, websocket.MessageText,
		[]byte(`{"type":"session.closed","reason":"close_requested","usage":{"seconds":15.5}}`))
	go func() { _ = vendor.Close(websocket.StatusNormalClosure, "") }()

	assert.Equal(t, ReasonClientClosed, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	last := reports[len(reports)-1]
	assert.True(t, last.Final)
	var seconds float64
	for _, report := range reports {
		if report.Usage != nil {
			seconds += report.Usage.AudioSeconds
		}
	}
	assert.InDelta(t, 15.5, seconds, 0.001)
}

// @scenario "An ElevenLabs speech socket is metered by the characters the client sends"
func TestRelayCountsSpeechCharacters(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindTTSSocket, func(o *Options) { o.Timing.UsageInterval = time.Hour })
	r.shape = func(call *RelayCall) {
		call.Path, call.RawQuery = "/v1/text-to-speech/voice_1/stream-input", "model_id=eleven_flash_v2_5"
		call.Count, call.FirstFrame = CountSpeechChars, StripSocketKeys
	}
	client, vendor := r.dial()

	opening := `{"text":" ","voice_settings":{"stability":0.5},"xi-api-key":"` + virtualKey + `","authorization":"Bearer ` + virtualKey + `"}`
	frames := []string{
		opening,
		`{"text":"Hello world ","flush":false}`,
		`{"text":"héllo ","xi-api-key":"kept-after-the-first-frame"}`,
		`{"text":" "}`,
		`{"text":""}`,
	}
	for _, frame := range frames {
		send(t, client, websocket.MessageText, []byte(frame))
	}

	first := r.vendor.frame()
	assert.JSONEq(t, `{"text":" ","voice_settings":{"stability":0.5}}`, string(first.data))
	assert.NotContains(t, string(first.data), virtualKey, "the first frame's key fields never reach the vendor")
	for _, frame := range frames[1:] {
		assert.Equal(t, frame, string(r.vendor.frame().data), "later frames are forwarded byte for byte")
	}
	audio := []byte(`{"audio":"QUJD","isFinal":null}`)
	send(t, vendor, websocket.MessageText, audio)
	assert.Equal(t, audio, readFrame(t, client).data)

	require.NoError(t, client.Close(websocket.StatusNormalClosure, ""))
	assert.Equal(t, ReasonClientClosed, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	chars := 0
	for _, report := range reports {
		if report.Usage != nil {
			chars += report.Usage.InputChars
		}
	}
	// One for the opening space, 12 and 6 for the two texts, one for the
	// keep-alive and none for the closing frame.
	assert.Equal(t, 20, chars)
	assert.Equal(t, "c-20", reports[len(reports)-2].ReportKey)
	assert.True(t, reports[len(reports)-1].Final)
}

// @scenario "ElevenLabs speech characters are reported at most once per interval"
func TestRelayReportsCountedCharactersWhileTheSocketRuns(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindTTSSocket, nil)
	r.shape = func(call *RelayCall) { call.Count = CountSpeechChars }
	client, _ := r.dial()

	send(t, client, websocket.MessageText, []byte(`{"text":"Hello "}`))
	first := r.registry.awaitReports(t, 1)[0]
	assert.Equal(t, "c-6", first.ReportKey)
	assert.Equal(t, 6, first.Usage.InputChars)

	send(t, client, websocket.MessageText, []byte(`{"text":"again ","context_id":"ctx_2"}`))
	second := r.registry.awaitReports(t, 2)[1]
	assert.Equal(t, "c-12", second.ReportKey, "the key is the cumulative count")
	assert.Equal(t, 6, second.Usage.InputChars, "the amount is the delta")
}

// @scenario "An ElevenLabs transcription socket is metered by the audio the client sends"
func TestRelayCountsTranscriptionAudio(t *testing.T) {
	t.Parallel()
	r := newRelayRig(t, domain.RealtimeKindSTTSocket, func(o *Options) { o.Timing.UsageInterval = time.Hour })
	r.shape = func(call *RelayCall) {
		call.Path, call.RawQuery = "/v1/speech-to-text/realtime", ""
		call.Count = CountAudio(AudioBytesPerSecond(""))
	}
	client, _ := r.dial()

	// 48000 bytes of pcm_16000 is 1.5 seconds: 64000 base64 characters.
	chunk := `{"message_type":"input_audio_chunk","audio_base_64":"` + strings.Repeat("A", 64000) + `","commit":false}`
	send(t, client, websocket.MessageText, []byte(chunk))
	send(t, client, websocket.MessageText, []byte(chunk))
	assert.Equal(t, chunk, string(r.vendor.frame().data))
	r.vendor.frame()

	require.NoError(t, client.Close(websocket.StatusNormalClosure, ""))
	assert.Equal(t, ReasonClientClosed, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	require.Len(t, reports, 2)
	assert.Equal(t, "a-3000", reports[0].ReportKey)
	assert.InDelta(t, 3.0, reports[0].Usage.AudioSeconds, 0.0001)
	assert.True(t, reports[1].Final)
}

func TestSpeechCharactersAreCountedPerField(t *testing.T) {
	t.Parallel()
	cases := map[string]int64{
		`{"text":" "}`:           1,
		`{"text":""}`:            0,
		`{"text":"héllo wörld"}`: 11,
		`{"text":"hi","context_id":"a","flush":true}`:  2,
		`{"inputs":[{"text":"one"},{"text":"three"}]}`: 8,
		`{"close_socket":true}`:                        0,
		`{"text":42}`:                                  0,
		`not json`:                                     0,
	}
	for frame, want := range cases {
		assert.Equal(t, want, CountSpeechChars([]byte(frame)), frame)
	}
}

func TestAudioIsCountedFromItsEncodedLength(t *testing.T) {
	t.Parallel()
	assert.Equal(t, int64(32000), AudioBytesPerSecond(""))
	assert.Equal(t, int64(32000), AudioBytesPerSecond("pcm_16000"))
	assert.Equal(t, int64(96000), AudioBytesPerSecond("pcm_48000"))
	assert.Equal(t, int64(8000), AudioBytesPerSecond("ulaw_8000"))
	assert.Equal(t, int64(32000), AudioBytesPerSecond("opus_48000"))

	ulaw := CountAudio(AudioBytesPerSecond("ulaw_8000"))
	// "QUJDRA==" is 4 bytes: half a millisecond of mu-law at 8 kHz.
	assert.Equal(t, int64(500), ulaw([]byte(`{"audio_base_64":"QUJDRA=="}`)))
	assert.Zero(t, ulaw([]byte(`{"message_type":"commit"}`)))
}

func TestSocketKeysAreStrippedOnlyWhenPresent(t *testing.T) {
	t.Parallel()
	plain := []byte(`{ "text": " " }`)
	assert.Equal(t, plain, StripSocketKeys(plain), "a frame with no key is the same bytes")

	stripped := StripSocketKeys([]byte(`{"text":" ","xi_api_key":"vk-1","authorization":"Bearer vk-1","context_id":"c"}`))
	assert.JSONEq(t, `{"text":" ","context_id":"c"}`, string(stripped))
}

func TestCloseCodesThatCannotBeSentTakeTheFallback(t *testing.T) {
	t.Parallel()
	code, reason := closeOf(errors.New("connection reset"), websocket.StatusInternalError, "lost")
	assert.Equal(t, websocket.StatusInternalError, code)
	assert.Equal(t, "lost", reason)

	code, _ = closeOf(websocket.CloseError{Code: websocket.StatusAbnormalClosure}, websocket.StatusInternalError, "lost")
	assert.Equal(t, websocket.StatusInternalError, code)

	code, reason = closeOf(websocket.CloseError{Code: 4000, Reason: strings.Repeat("é", 100)}, websocket.StatusInternalError, "")
	assert.Equal(t, websocket.StatusCode(4000), code)
	assert.LessOrEqual(t, len(reason), 123)
	assert.True(t, strings.HasSuffix(reason, "é"), "the reason is cut on a character boundary")
}
