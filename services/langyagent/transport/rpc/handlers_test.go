package rpc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	httprpc "github.com/langwatch/langwatch/pkg/rpc"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// --- stubs implementing the app ports ---

type stubWorker struct{ claimOK bool }

func (w *stubWorker) ClaimTurn(string) app.ClaimOutcome {
	if w.claimOK {
		return app.ClaimGranted
	}
	return app.ClaimBusy
}
func (w *stubWorker) Release()                                                  {}
func (w *stubWorker) Touch()                                                    {}
func (w *stubWorker) SetTurnTraceContext(trace.SpanContext)                     {}
func (w *stubWorker) LastLLMError() (herr.E, bool)                              { return herr.E{}, false }
func (w *stubWorker) PostMessage(context.Context, string, string, string) error { return nil }
func (w *stubWorker) StreamEvents(_ context.Context, sink app.ChatSink) error {
	f, _ := frames.Delta("hi")
	_ = sink.Emit(f)
	return nil
}

type stubPool struct {
	acquireErr error
	worker     app.Worker
	liveWorker bool
	lastSig    domain.CredentialSignature
	lastCreds  domain.Credentials
}

func (p *stubPool) HasLiveWorker(_ string, sig domain.CredentialSignature) bool {
	p.lastSig = sig
	return p.liveWorker
}

func (p *stubPool) Acquire(_ context.Context, _ string, creds domain.Credentials) (app.Worker, error) {
	p.lastCreds = creds
	if p.acquireErr != nil {
		return nil, p.acquireErr
	}
	return p.worker, nil
}
func (p *stubPool) Status() (int, int)                         { return 2, 20 }
func (p *stubPool) KillSessionVanished(string)                 {}
func (p *stubPool) StartReaper()                               {}
func (p *stubPool) ShutdownHandoff(context.Context, time.Time) {}
func (p *stubPool) Shutdown()                                  {}

const internalSecret = "test-internal-secret"

func newTestRouter(pool app.WorkerPool) http.Handler {
	application := app.New(app.WithWorkerPool(pool))
	probes := health.New("test")
	probes.MarkStarted() // deps.NewDeps does this once init completes.
	return NewRouter(RouterDeps{
		App:                 application,
		Health:              probes,
		InternalSecret:      internalSecret,
		MaxRequestBodyBytes: 1_000_000,
	})
}

const validBody = `{"conversationId":"c1","projectId":"project-1","userId":"user-a","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`

func postChat(t *testing.T, router http.Handler, auth, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/worker/create", strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func errorType(t *testing.T, body string) string {
	t.Helper()
	var env struct {
		Error struct {
			Type string `json:"type"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &env); err != nil {
		t.Fatalf("body is not a herr envelope: %v (%q)", err, body)
	}
	return env.Error.Type
}

func TestChat_RejectsMissingAndWrongSecretWithHerrEnvelope(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: true}})

	for _, auth := range []string{"", "Bearer wrong-secret", "Basic " + internalSecret} {
		rec := postChat(t, router, auth, validBody)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("auth %q: status = %d, want 401", auth, rec.Code)
		}
		if got := errorType(t, rec.Body.String()); got != string(domain.ErrUnauthorized) {
			t.Errorf("auth %q: error.type = %q, want unauthorized", auth, got)
		}
	}
}

func TestChat_ValidationErrors(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: true}})
	auth := "Bearer " + internalSecret

	cases := []struct {
		name     string
		body     string
		wantCode int
		wantType string
	}{
		{"invalid json", `{not-json`, http.StatusBadRequest, string(httprpc.CodeBadRequest)},
		{"missing conversationId", `{"projectId":"project-1","userId":"user-a","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, http.StatusUnprocessableEntity, string(httprpc.CodeUnprocessable)},
		{"missing projectId", `{"conversationId":"c1","userId":"user-a","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, http.StatusUnprocessableEntity, string(httprpc.CodeUnprocessable)},
		{"missing userId", `{"conversationId":"c1","projectId":"project-1","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, http.StatusUnprocessableEntity, string(httprpc.CodeUnprocessable)},
		{"missing prompt", `{"conversationId":"c1","projectId":"project-1","userId":"user-a","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, http.StatusUnprocessableEntity, string(httprpc.CodeUnprocessable)},
		{"path-escaping conversationId", `{"conversationId":"../etc","projectId":"project-1","userId":"user-a","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, http.StatusUnprocessableEntity, string(domain.ErrInvalidConversationID)},
		{"incomplete credentials", `{"conversationId":"c1","projectId":"project-1","userId":"user-a","prompt":"hi","credentials":{"langwatchApiKey":"k"}}`, http.StatusUnprocessableEntity, string(httprpc.CodeUnprocessable)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postChat(t, router, auth, tc.body)
			if rec.Code != tc.wantCode {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantCode)
			}
			if got := errorType(t, rec.Body.String()); got != tc.wantType {
				t.Errorf("error.type = %q, want %q", got, tc.wantType)
			}
		})
	}
}

// Validation failures must be a herr(ErrBadRequest) whose diagnostics NAME the
// offending field (in Meta.fields), while the user-facing message stays generic.
func TestChat_ValidationNamesOffendingField(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: true}})
	auth := "Bearer " + internalSecret

	cases := []struct {
		name      string
		body      string
		wantField string
	}{
		{"missing conversationId", `{"projectId":"project-1","userId":"user-a","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, "ConversationID"},
		{"missing prompt", `{"conversationId":"c1","projectId":"project-1","userId":"user-a","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, "Prompt"},
		{"missing credential field", `{"conversationId":"c1","projectId":"project-1","userId":"user-a","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g"}}`, "Credentials.LangwatchEndpoint"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postChat(t, router, auth, tc.body)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", rec.Code)
			}
			var env struct {
				Error struct {
					Type    string `json:"type"`
					Message string `json:"message"`
					Meta    struct {
						Fields []string `json:"fields"`
					} `json:"meta"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode envelope: %v (%q)", err, rec.Body.String())
			}
			if env.Error.Type != string(httprpc.CodeUnprocessable) {
				t.Errorf("error.type = %q, want the error code", env.Error.Type)
			}
			// The user message must NOT echo the raw field name.
			if strings.Contains(env.Error.Message, tc.wantField) {
				t.Errorf("user message %q leaked the internal field path", env.Error.Message)
			}
			found := false
			for _, f := range env.Error.Meta.Fields {
				if f == tc.wantField {
					found = true
				}
			}
			if !found {
				t.Errorf("validation must name field %q in diagnostics, got fields=%v", tc.wantField, env.Error.Meta.Fields)
			}
		})
	}
}

func TestChat_ConversationBusyReturns409(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: false}})
	rec := postChat(t, router, "Bearer "+internalSecret, validBody)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if got := errorType(t, rec.Body.String()); got != string(domain.ErrConversationBusy) {
		t.Errorf("error.type = %q, want conversation_busy", got)
	}
}

// At capacity is now a synchronous HTTP status (503), not a 200 stream event —
// there is no in-band response to carry an error event; the dispatcher decides.
func TestChat_AtCapacityReturns503(t *testing.T) {
	pool := &stubPool{acquireErr: herr.New(context.Background(), domain.ErrMaxWorkers, nil)}
	router := newTestRouter(pool)
	rec := postChat(t, router, "Bearer "+internalSecret, validBody)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (at capacity)", rec.Code)
	}
	if got := errorType(t, rec.Body.String()); got != string(domain.ErrMaxWorkers) {
		t.Errorf("error.type = %q, want max_workers_reached", got)
	}
}

// The happy path Claims the worker synchronously and returns 202; the turn's
// output then flows out-of-band as signed frames to the relay, not on the
// response body.
func TestChat_HappyPathReturns202(t *testing.T) {
	pool := &stubPool{worker: &stubWorker{claimOK: true}}
	router := newTestRouter(pool)
	rec := postChat(t, router, "Bearer "+internalSecret, validBody)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if pool.lastCreds.ProjectID != "project-1" || pool.lastCreds.ActorUserID != "user-a" {
		t.Fatalf("worker principal = %q/%q", pool.lastCreds.ProjectID, pool.lastCreds.ActorUserID)
	}
}

func TestChat_WrongMethodIs405(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: true}})
	req := httptest.NewRequest(http.MethodGet, "/worker/create", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET /worker/create status = %d, want 405", rec.Code)
	}
}

func TestHealth_Endpoints(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: true}})

	// Legacy /health alias reports the worker count in the flat-manager shape.
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/health status = %d, want 200", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), "ok (2/20 workers)") {
		t.Errorf("/health body = %q, want it to contain the worker count", string(body))
	}

	// k8s probes.
	for _, path := range []string{"/healthz", "/readyz", "/startupz"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s status = %d, want 200", path, rec.Code)
		}
	}
}
