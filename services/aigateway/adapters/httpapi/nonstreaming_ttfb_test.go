package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ttfbSpyWriter records whether anything has actually been flushed to the
// transport — WriteHeader or Write. Go's net/http buffers header-map
// mutations (w.Header().Set(...)) client-side and does not put a single
// byte on the wire until the first real WriteHeader/Write call, so
// inspecting httptest.ResponseRecorder's header map or its Code field
// (pre-seeded to 200) cannot distinguish "nothing sent yet" from "sent."
// This spy answers the only question that matters for an edge proxy's
// idle-connection timeout: has the origin emitted any bytes at all.
//
// wroteAny is an atomic.Bool, not a plain bool: ServeHTTP runs on a
// goroutine the test spawns explicitly, while the test's main goroutine
// polls this field via require.Eventually — a plain bool there is a real
// data race caught by `go test -race` (this is a test-harness concern
// only; the production heartbeatWriter.started field below is never
// touched by more than one goroutine, since the background dispatch
// goroutine never accesses the ResponseWriter).
type ttfbSpyWriter struct {
	http.ResponseWriter
	wroteAny atomic.Bool
}

func (s *ttfbSpyWriter) WriteHeader(statusCode int) {
	s.wroteAny.Store(true)
	s.ResponseWriter.WriteHeader(statusCode)
}

func (s *ttfbSpyWriter) Write(p []byte) (int, error) {
	s.wroteAny.Store(true)
	return s.ResponseWriter.Write(p)
}

// TestRouter_NonStreaming_NoBytesReachClientWhileProviderIsSlow documents the
// baseline behind https://github.com/langwatch/langwatch/issues/4806: with
// no explicit HeartbeatInterval configured (buildRouter's default —
// resolves to config.DefaultNonStreamingHeartbeatInterval, 45s), a dispatch
// that finishes well inside that window is byte-for-byte identical to
// before the fix — nothing reaches the client until the provider call
// returns. This is intentional: only dispatches slower than the interval
// (see TestRouter_NonStreaming_HeartbeatKeepsConnectionWarm below) pay the
// heartbeat's status-commitment trade-off; everything else, including
// every fast error response, is completely unaffected.
//
// See specs/ai-gateway/non-streaming-time-to-first-byte.feature.
//
// @scenario "non-streaming client receives zero response bytes for dispatch faster than the heartbeat interval"
func TestRouter_NonStreaming_NoBytesReachClientWhileProviderIsSlow(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}

	providerEntered := make(chan struct{})
	releaseProvider := make(chan struct{})
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			close(providerEntered)
			<-releaseProvider // held open to stand in for a slow, large-context completion
			return successResponse(), nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	spy := &ttfbSpyWriter{ResponseWriter: rec}

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(spy, req)
		close(done)
	}()

	select {
	case <-providerEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("provider was never dialed")
	}

	// The provider call is deliberately still in flight here. If the
	// gateway had any mechanism to keep the connection warm (streaming,
	// heartbeat bytes, early headers), something would have hit the wire
	// by now — it has not.
	assert.False(t, spy.wroteAny.Load(), "no bytes should reach the client transport while the provider call is still in flight")

	close(releaseProvider)

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler never completed after the provider call returned")
	}

	// Once the (slow) provider finally returns, the full response arrives
	// as a single burst — this isn't a hang, just an all-or-nothing
	// delivery with no mechanism to bridge a proxy's idle-connection
	// timeout while the burst is being assembled.
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.NotZero(t, rec.Body.Len())
}

// TestRouter_NonStreaming_HeartbeatKeepsConnectionWarm proves the fix for
// #4806: once a non-streaming dispatch runs longer than HeartbeatInterval,
// the gateway starts writing keep-alive bytes to the client — resetting any
// edge proxy's idle-connection timer — while the provider call is still
// running, and still delivers the exact correct response, with the correct
// Content-Type, once the provider call finally returns.
//
// @scenario "dispatch slower than the heartbeat interval keeps the connection warm and still delivers the correct response"
func TestRouter_NonStreaming_HeartbeatKeepsConnectionWarm(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}

	providerEntered := make(chan struct{})
	releaseProvider := make(chan struct{})
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			close(providerEntered)
			<-releaseProvider
			return successResponse(), nil
		},
	}

	reg := health.New("test")
	reg.MarkStarted()
	application := app.New(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)
	router := NewRouter(RouterDeps{
		App:               application,
		Logger:            zap.NewNop(),
		Health:            reg,
		HeartbeatInterval: 5 * time.Millisecond,
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	spy := &ttfbSpyWriter{ResponseWriter: rec}

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(spy, req)
		close(done)
	}()

	select {
	case <-providerEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("provider was never dialed")
	}

	require.Eventually(t, func() bool { return spy.wroteAny.Load() }, 2*time.Second, 5*time.Millisecond,
		"a heartbeat byte should reach the client while the provider call is still in flight")

	// The connection is warm, but dispatch is still genuinely running in
	// the background — the heartbeat doesn't short-circuit it.
	select {
	case <-done:
		t.Fatal("handler completed before the provider call returned")
	default:
	}

	close(releaseProvider)

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler never completed after the provider call returned")
	}

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	// The body is prefixed by one or more heartbeat bytes (insignificant
	// JSON whitespace, RFC 8259 §2) ahead of the real payload — proving
	// Go's own json.Unmarshal, not just a claim in a comment, still parses
	// it correctly is the point of this assertion.
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body, "choices")
}

// TestRouter_NonStreaming_HeartbeatThenError_StillDeliversStructuredErrorBody
// documents the one bounded trade-off of the #4806 fix: once a heartbeat
// has flushed, the HTTP status is irrevocably committed to 200 (net/http
// sends it implicitly on the first Write) — the same trade-off the
// streaming path already accepts for errors that surface mid-stream (see
// streaming.feature). If dispatch ultimately errors after heartbeating has
// started, the wire status can no longer become the real 4xx/5xx, but the
// body still carries the exact same structured error a fast failure would
// have produced, so a client inspecting the body (not just the status)
// still gets the accurate error — a strict improvement over today's
// 524 with no body at all.
//
// @scenario "dispatch that errors after heartbeating has started still delivers a structured error body"
func TestRouter_NonStreaming_HeartbeatThenError_StillDeliversStructuredErrorBody(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}

	providerEntered := make(chan struct{})
	releaseProvider := make(chan struct{})
	provider := &mockProvider{
		dispatchFn: func(ctx context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			close(providerEntered)
			<-releaseProvider
			return nil, herr.New(ctx, domain.ErrProviderError, nil)
		},
	}

	reg := health.New("test")
	reg.MarkStarted()
	application := app.New(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)
	router := NewRouter(RouterDeps{
		App:               application,
		Logger:            zap.NewNop(),
		Health:            reg,
		HeartbeatInterval: 5 * time.Millisecond,
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	spy := &ttfbSpyWriter{ResponseWriter: rec}

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(spy, req)
		close(done)
	}()

	select {
	case <-providerEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("provider was never dialed")
	}

	require.Eventually(t, func() bool { return spy.wroteAny.Load() }, 2*time.Second, 5*time.Millisecond,
		"a heartbeat byte should reach the client before the provider call errors")

	close(releaseProvider)

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler never completed after the provider call returned")
	}

	// Status is stuck at 200 — already committed by the heartbeat — but the
	// body still carries the real, structured error.
	assert.Equal(t, http.StatusOK, rec.Code)

	var errResp herr.ErrorResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &errResp))
	assert.Equal(t, "provider_error", errResp.Error.Type)
}

// TestRouter_NonStreaming_HeartbeatDisabled proves the negative-interval
// escape hatch: no heartbeat byte is ever written, matching pre-fix
// behavior exactly, for operators who need to turn the mechanism off
// without a redeploy (e.g. NON_STREAMING_HEARTBEAT_INTERVAL=-1s).
//
// @scenario "a negative heartbeat interval disables the mechanism entirely"
func TestRouter_NonStreaming_HeartbeatDisabled(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}

	providerEntered := make(chan struct{})
	releaseProvider := make(chan struct{})
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			close(providerEntered)
			<-releaseProvider
			return successResponse(), nil
		},
	}

	reg := health.New("test")
	reg.MarkStarted()
	application := app.New(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)
	router := NewRouter(RouterDeps{
		App:               application,
		Logger:            zap.NewNop(),
		Health:            reg,
		HeartbeatInterval: -1 * time.Millisecond,
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	spy := &ttfbSpyWriter{ResponseWriter: rec}

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(spy, req)
		close(done)
	}()

	select {
	case <-providerEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("provider was never dialed")
	}

	// Generously longer than several would-be 5ms ticks — with
	// heartbeating disabled, nothing should ever fire.
	time.Sleep(50 * time.Millisecond)
	assert.False(t, spy.wroteAny.Load(), "a negative HeartbeatInterval must disable heartbeating entirely")

	close(releaseProvider)

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler never completed after the provider call returned")
	}

	assert.Equal(t, http.StatusOK, rec.Code)
}

// TestRouter_NonStreaming_HeartbeatFiresAcrossEveryRoute proves the fix is
// wired correctly at all five non-streaming call sites — chat, messages,
// responses, embeddings, and the Gemini passthrough — not just chat
// completions. A copy-paste mistake at any one of the five withHeartbeat
// call sites in router.go would silently leave that specific route exposed
// to #4806 again while every test targeting only /v1/chat/completions kept
// passing, so each route gets its own pass through the exact same
// slow-provider-then-release choreography.
func TestRouter_NonStreaming_HeartbeatFiresAcrossEveryRoute(t *testing.T) {
	cases := []struct {
		name       string
		method     string
		path       string
		body       []byte
		respBody   []byte
		bodyMarker string
	}{
		{
			name:       "chat_completions",
			method:     http.MethodPost,
			path:       "/v1/chat/completions",
			body:       chatBody(),
			bodyMarker: "choices",
		},
		{
			name:       "messages",
			method:     http.MethodPost,
			path:       "/v1/messages",
			body:       chatBody(),
			bodyMarker: "choices",
		},
		{
			name:       "responses",
			method:     http.MethodPost,
			path:       "/v1/responses",
			body:       chatBody(),
			bodyMarker: "choices",
		},
		{
			name:       "embeddings",
			method:     http.MethodPost,
			path:       "/v1/embeddings",
			body:       chatBody(),
			bodyMarker: "choices",
		},
		{
			name:       "gemini_passthrough",
			method:     http.MethodPost,
			path:       "/v1beta/models/gemini-2.5-flash:generateContent",
			body:       []byte(`{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`),
			respBody:   []byte(`{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}`),
			bodyMarker: "candidates",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			auth := &mockAuth{
				resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
					return testBundle(), nil
				},
			}

			providerEntered := make(chan struct{})
			releaseProvider := make(chan struct{})
			provider := &mockProvider{
				dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
					close(providerEntered)
					<-releaseProvider
					if tc.respBody != nil {
						return &domain.Response{Body: tc.respBody, StatusCode: 200}, nil
					}
					return successResponse(), nil
				},
			}

			reg := health.New("test")
			reg.MarkStarted()
			application := app.New(
				app.WithAuth(auth),
				app.WithProviders(provider),
				app.WithLogger(zap.NewNop()),
			)
			router := NewRouter(RouterDeps{
				App:               application,
				Logger:            zap.NewNop(),
				Health:            reg,
				HeartbeatInterval: 5 * time.Millisecond,
			})

			req := httptest.NewRequest(tc.method, tc.path, bytes.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer vk-lw-test")
			req.Header.Set("X-Goog-Api-Key", "vk-lw-test") // gemini passthrough auth path
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			spy := &ttfbSpyWriter{ResponseWriter: rec}

			done := make(chan struct{})
			go func() {
				router.ServeHTTP(spy, req)
				close(done)
			}()

			select {
			case <-providerEntered:
			case <-time.After(2 * time.Second):
				t.Fatal("provider was never dialed")
			}

			require.Eventually(t, func() bool { return spy.wroteAny.Load() }, 2*time.Second, 5*time.Millisecond,
				"a heartbeat byte should reach the client on this route while dispatch is in flight")

			close(releaseProvider)

			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("handler never completed after dispatch returned")
			}

			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Contains(t, rec.Body.String(), tc.bodyMarker)
		})
	}
}

// TestRouter_NonStreaming_ConcurrentSlowRequestsDoNotInterfere runs two
// slow, heartbeating requests side by side and proves neither leaks state
// into the other — each withHeartbeat call owns its own ticker, goroutine,
// and wrapped writer, so nothing is shared across concurrent requests.
func TestRouter_NonStreaming_ConcurrentSlowRequestsDoNotInterfere(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}

	type reqState struct {
		entered chan struct{}
		release chan struct{}
	}
	states := map[string]*reqState{
		"req-a": {entered: make(chan struct{}), release: make(chan struct{})},
		"req-b": {entered: make(chan struct{}), release: make(chan struct{})},
	}

	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			// The model name threads the two concurrent requests apart —
			// both hit the same handler and the same mock, so this is the
			// only signal available to tell them apart from inside dispatch.
			st := states[req.Model]
			close(st.entered)
			<-st.release
			return successResponse(), nil
		},
	}

	reg := health.New("test")
	reg.MarkStarted()
	application := app.New(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)
	router := NewRouter(RouterDeps{
		App:               application,
		Logger:            zap.NewNop(),
		Health:            reg,
		HeartbeatInterval: 5 * time.Millisecond,
	})

	recA, recB := httptest.NewRecorder(), httptest.NewRecorder()
	spyA := &ttfbSpyWriter{ResponseWriter: recA}
	spyB := &ttfbSpyWriter{ResponseWriter: recB}

	bodyFor := func(model string) []byte {
		return []byte(`{"model":"` + model + `","messages":[{"role":"user","content":"hi"}]}`)
	}
	reqA := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(bodyFor("req-a")))
	reqA.Header.Set("Authorization", "Bearer vk-lw-test")
	reqB := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(bodyFor("req-b")))
	reqB.Header.Set("Authorization", "Bearer vk-lw-test")

	doneA, doneB := make(chan struct{}), make(chan struct{})
	go func() { router.ServeHTTP(spyA, reqA); close(doneA) }()
	go func() { router.ServeHTTP(spyB, reqB); close(doneB) }()

	for _, st := range states {
		select {
		case <-st.entered:
		case <-time.After(2 * time.Second):
			t.Fatal("a provider call was never dialed")
		}
	}

	require.Eventually(t, func() bool { return spyA.wroteAny.Load() }, 2*time.Second, 5*time.Millisecond, "req-a should have heartbeat bytes")
	require.Eventually(t, func() bool { return spyB.wroteAny.Load() }, 2*time.Second, 5*time.Millisecond, "req-b should have heartbeat bytes")

	// Release only req-a; req-b must keep running independently — proves
	// the two heartbeat loops (goroutine + ticker each) aren't sharing
	// state that would let releasing one affect the other.
	close(states["req-a"].release)
	select {
	case <-doneA:
	case <-time.After(2 * time.Second):
		t.Fatal("req-a never completed")
	}
	select {
	case <-doneB:
		t.Fatal("req-b completed before its own provider call was released")
	default:
	}

	close(states["req-b"].release)
	select {
	case <-doneB:
	case <-time.After(2 * time.Second):
		t.Fatal("req-b never completed")
	}

	assert.Equal(t, http.StatusOK, recA.Code)
	assert.Equal(t, http.StatusOK, recB.Code)
	assert.Contains(t, recA.Body.String(), "choices")
	assert.Contains(t, recB.Body.String(), "choices")
}
