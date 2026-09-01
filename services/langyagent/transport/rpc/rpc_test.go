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
func TestWarm_InvalidConversationIDReturns422(t *testing.T) {
	router := newTestRouter(&stubPool{})
	body := `{"conversationId":"../etc","projectId":"project-1","actorUserId":"user-a","credentials":{"langwatchApiKey":"k","llmVirtualKey":"vk","gatewayBaseUrl":"g","langwatchEndpoint":"e"}}`
	rec := post(t, router, "/warm", body)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
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

// The probe folded a harness into the signature it compares until ADR-131, so
// that a flip was a MISS. With one harness there is nothing to compare, and
// what has to hold instead is tolerance: a control plane mid-rollout still
// sends `harness`, and the probe is the FIRST call of every turn — refusing it
// would fail the turn before a worker was even looked for.
//
// @scenario "A turn that names the removed harness still runs"
func TestProbe_AnswersAnEnvelopeThatStillNamesAHarness(t *testing.T) {
	pool := &stubPool{liveWorker: true}
	router := newTestRouter(pool)

	rec := post(t, router, "/worker/probe", `{"conversationId":"c1","projectId":"project-1","actorUserId":"user-a","model":"m","harness":"opencode"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("a probe naming the removed harness must be answered, status = %d", rec.Code)
	}

	// And it must ask the SAME question as one that names none — otherwise the
	// two would disagree about whether the live worker matches, and a turn would
	// respawn a worker that was already serving it.
	withHarness := pool.lastSig
	rec = post(t, router, "/worker/probe", `{"conversationId":"c1","projectId":"project-1","actorUserId":"user-a","model":"m"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if pool.lastSig != withHarness {
		t.Fatalf("naming a harness must not change the signature (with=%+v without=%+v)", withHarness, pool.lastSig)
	}
}

// A cancel is the token-burn half of the user's Stop (ADR-078): fire-and-forget,
// 204 with no body, handed straight to the pool for the named conversation+turn.
//
// @scenario "A stop makes the manager abort the in-flight generation"
func TestCancel_ValidReturns204AndReachesThePool(t *testing.T) {
	pool := &stubPool{}
	router := newTestRouter(pool)

	rec := post(t, router, "/worker/cancel", `{"conversationId":"c1","turnId":"turn-1","projectId":"project-1"}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("204 must have no body, got %q", rec.Body.String())
	}
	if len(pool.canceled) != 1 || pool.canceled[0] != "c1/turn-1" {
		t.Fatalf("canceled = %v, want exactly c1/turn-1", pool.canceled)
	}
}

// A cancel that finds nothing to halt is still a success: the stop is already
// truthful on the durable record, so a no-op pool answer stays a 204.
func TestCancel_NoOpStillReturns204(t *testing.T) {
	router := newTestRouter(&stubPool{})
	rec := post(t, router, "/worker/cancel", `{"conversationId":"conv-without-worker","turnId":"turn-9"}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 even when nothing was halted", rec.Code)
	}
}

// A cancel needs a name on both axes: the conversation that routes it and the
// turn it is allowed to kill. Missing either is a validation refusal, and a
// path-escaping conversationId is rejected like everywhere else.
func TestCancel_ValidationErrors(t *testing.T) {
	cases := []struct {
		name     string
		body     string
		wantType string
	}{
		{"missing turnId", `{"conversationId":"c1"}`, ""},
		{"missing conversationId", `{"turnId":"turn-1"}`, ""},
		{"path-escaping conversationId", `{"conversationId":"../etc","turnId":"turn-1"}`, string(domain.ErrInvalidConversationID)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pool := &stubPool{}
			router := newTestRouter(pool)
			rec := post(t, router, "/worker/cancel", tc.body)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", rec.Code)
			}
			if tc.wantType != "" {
				if got := errorType(t, rec.Body.String()); got != tc.wantType {
					t.Errorf("error type = %q, want %q", got, tc.wantType)
				}
			}
			if len(pool.canceled) != 0 {
				t.Errorf("an invalid cancel must never reach the pool, got %v", pool.canceled)
			}
		})
	}
}

func TestProbe_InvalidConversationIDReturns422(t *testing.T) {
	router := newTestRouter(&stubPool{})
	rec := post(t, router, "/worker/probe", `{"conversationId":"../etc","projectId":"project-1","actorUserId":"user-a"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if got := errorType(t, rec.Body.String()); got != string(domain.ErrInvalidConversationID) {
		t.Errorf("error type = %q, want %q", got, domain.ErrInvalidConversationID)
	}
}
