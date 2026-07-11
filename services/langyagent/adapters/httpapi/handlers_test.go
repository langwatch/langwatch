package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// --- stubs implementing the app ports ---

type stubWorker struct{ claimOK bool }

func (w *stubWorker) Claim() bool                                       { return w.claimOK }
func (w *stubWorker) Release()                                          {}
func (w *stubWorker) Touch()                                            {}
func (w *stubWorker) PostMessage(context.Context, string, string) error { return nil }
func (w *stubWorker) StreamEvents(_ context.Context, sink app.ChatSink) error {
	_, _ = sink.Write([]byte("{\"type\":\"message.part.delta\"}\n"))
	return nil
}

type stubPool struct {
	acquireErr error
	worker     app.Worker
}

func (p *stubPool) Acquire(context.Context, string, domain.Credentials) (app.Worker, error) {
	if p.acquireErr != nil {
		return nil, p.acquireErr
	}
	return p.worker, nil
}
func (p *stubPool) Status() (int, int)         { return 2, 20 }
func (p *stubPool) KillSessionVanished(string) {}
func (p *stubPool) StartReaper()               {}
func (p *stubPool) Shutdown()                  {}

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

const validBody = `{"conversationId":"c1","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`

func postChat(t *testing.T, router http.Handler, auth, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/chat", strings.NewReader(body))
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
		{"invalid json", `{not-json`, http.StatusBadRequest, string(domain.ErrBadRequest)},
		{"missing conversationId", `{"prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, http.StatusBadRequest, string(domain.ErrBadRequest)},
		{"missing prompt", `{"conversationId":"c1","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, http.StatusBadRequest, string(domain.ErrBadRequest)},
		{"path-escaping conversationId", `{"conversationId":"../etc","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, http.StatusBadRequest, string(domain.ErrInvalidConversationID)},
		{"incomplete credentials", `{"conversationId":"c1","prompt":"hi","credentials":{"langwatchApiKey":"k"}}`, http.StatusBadRequest, string(domain.ErrBadRequest)},
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
		{"missing conversationId", `{"prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, "ConversationID"},
		{"missing prompt", `{"conversationId":"c1","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`, "Prompt"},
		{"missing credential field", `{"conversationId":"c1","prompt":"hi","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g"}}`, "Credentials.LangwatchEndpoint"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postChat(t, router, auth, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
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
			if env.Error.Type != string(domain.ErrBadRequest) {
				t.Errorf("error.type = %q, want bad_request", env.Error.Type)
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

func TestChat_AtCapacityStreams200WithErrorEvent(t *testing.T) {
	pool := &stubPool{acquireErr: herr.New(context.Background(), domain.ErrMaxWorkers, nil)}
	router := newTestRouter(pool)
	rec := postChat(t, router, "Bearer "+internalSecret, validBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (at-capacity is a stream event, not an HTTP error)", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "at-capacity") {
		t.Errorf("body should carry the at-capacity error event, got %q", rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/x-ndjson" {
		t.Errorf("Content-Type = %q, want application/x-ndjson", ct)
	}
}

func TestChat_HappyPathStreamsNdjson(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: true}})
	rec := postChat(t, router, "Bearer "+internalSecret, validBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "message.part.delta") {
		t.Errorf("body should carry the streamed opencode event, got %q", rec.Body.String())
	}
}

func TestChat_WrongMethodIs405(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: true}})
	req := httptest.NewRequest(http.MethodGet, "/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET /chat status = %d, want 405", rec.Code)
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
