package rpc

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// A warm carries the same credential shape a turn does (it must spawn a matching
// worker). The full body validates + launches the detached warm and returns 204.
const validWarmBody = `{"conversationId":"c1","projectId":"project-1","actorUserId":"user-a","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`

func post(t *testing.T, router http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+internalSecret)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// A valid warm is fire-and-forget: 204, no body. The detached spawn runs against
// the stub pool in the background.
func TestWarm_ValidReturns204(t *testing.T) {
	router := newTestRouter(&stubPool{worker: &stubWorker{claimOK: true}})
	rec := post(t, router, "/warm", validWarmBody)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("204 must have no body, got %q", rec.Body.String())
	}
}

// A path-escaping conversationId is rejected before any spawn, as the field-typed
// herr envelope.
func TestWarm_InvalidConversationIDReturns400(t *testing.T) {
	router := newTestRouter(&stubPool{})
	body := `{"conversationId":"../etc","projectId":"project-1","actorUserId":"user-a","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`
	rec := post(t, router, "/warm", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if got := errorType(t, rec.Body.String()); got != string(domain.ErrInvalidConversationID) {
		t.Errorf("error type = %q, want %q", got, domain.ErrInvalidConversationID)
	}
}

// Probe reflects the pool's HasLiveWorker answer as {"alive":bool}, 200.
func TestProbe_ReflectsPoolLiveWorker(t *testing.T) {
	for _, live := range []bool{true, false} {
		router := newTestRouter(&stubPool{liveWorker: live})
		rec := post(t, router, "/worker/probe", `{"conversationId":"c1","projectId":"project-1","actorUserId":"user-a","model":"m"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var resp struct {
			Alive bool `json:"alive"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("probe response not JSON: %v (%q)", err, rec.Body.String())
		}
		if resp.Alive != live {
			t.Errorf("alive = %v, want %v", resp.Alive, live)
		}
	}
}

func TestProbe_BindsSignatureToPrincipal(t *testing.T) {
	pool := &stubPool{liveWorker: true}
	router := newTestRouter(pool)
	rec := post(t, router, "/worker/probe", `{"conversationId":"c1","projectId":"project-1","actorUserId":"user-a","model":"m"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if pool.lastSig.ProjectID != "project-1" || pool.lastSig.ActorUserID != "user-a" {
		t.Fatalf("probe signature principal = %q/%q", pool.lastSig.ProjectID, pool.lastSig.ActorUserID)
	}
}

func TestProbe_InvalidConversationIDReturns400(t *testing.T) {
	router := newTestRouter(&stubPool{})
	rec := post(t, router, "/worker/probe", `{"conversationId":"../etc","projectId":"project-1","actorUserId":"user-a"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if got := errorType(t, rec.Body.String()); got != string(domain.ErrInvalidConversationID) {
		t.Errorf("error type = %q, want %q", got, domain.ErrInvalidConversationID)
	}
}
