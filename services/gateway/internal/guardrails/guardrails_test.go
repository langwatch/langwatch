package guardrails

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newClient(t *testing.T, endpoint string) *Client {
	t.Helper()
	return New(Options{
		ControlPlaneBaseURL: endpoint,
		Logger:              quiet(),
		Timeouts: Timeouts{
			Pre:         200 * time.Millisecond,
			Post:        200 * time.Millisecond,
			StreamChunk: 20 * time.Millisecond,
		},
	})
}

func reply(w http.ResponseWriter, decision, reason string, policies []string) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"decision":           decision,
		"reason":             reason,
		"policies_triggered": policies,
	})
}

func TestAllowWhenNoGuardrails(t *testing.T) {
	c := newClient(t, "http://ignored")
	r, err := c.Check(context.Background(), Request{Direction: DirectionRequest})
	if err != nil || r.Verdict != VerdictAllow {
		t.Fatalf("expected allow w/o calls, got %+v err=%v", r, err)
	}
}

func TestBlockShortCircuits(t *testing.T) {
	// Two guardrails: one is slow (allow), one is fast (block). The block
	// should arrive first and cause cancellation of the slow call.
	var firstDone atomic.Bool
	var slowSaw atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		id := req.GuardrailIDs[0]
		if id == "guard_slow" {
			slowSaw.Store(true)
			select {
			case <-time.After(300 * time.Millisecond):
				reply(w, "allow", "", nil)
			case <-r.Context().Done():
				return
			}
			return
		}
		firstDone.Store(true)
		reply(w, "block", "pii detected", []string{"pii-ssn"})
	}))
	defer srv.Close()

	c := newClient(t, srv.URL)
	res, err := c.Check(context.Background(), Request{
		Direction:    DirectionRequest,
		GuardrailIDs: []string{"guard_fast_block", "guard_slow"},
	})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if res.Verdict != VerdictBlock {
		t.Fatalf("expected block, got %+v", res)
	}
	if len(res.PoliciesTriggered) != 1 || res.PoliciesTriggered[0] != "pii-ssn" {
		t.Errorf("policies: %+v", res.PoliciesTriggered)
	}
}

func TestParallelBothAllow(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		reply(w, "allow", "", nil)
	}))
	defer srv.Close()
	c := newClient(t, srv.URL)
	res, err := c.Check(context.Background(), Request{
		Direction:    DirectionRequest,
		GuardrailIDs: []string{"a", "b", "c"},
	})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if res.Verdict != VerdictAllow {
		t.Errorf("expected allow, got %s", res.Verdict)
	}
	if hits.Load() != 3 {
		t.Errorf("expected 3 parallel calls, got %d", hits.Load())
	}
}

func TestStreamChunkFailsOpenOnTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(200 * time.Millisecond):
			reply(w, "allow", "", nil)
		case <-r.Context().Done():
			return
		}
	}))
	defer srv.Close()
	c := newClient(t, srv.URL)
	res := c.CheckChunk(context.Background(), Request{
		Direction:    DirectionStreamChunk,
		GuardrailIDs: []string{"slow-one"},
		Content:      RequestContent{Chunk: "hello"},
	})
	if res.Verdict != VerdictAllow {
		t.Fatalf("stream chunk should fail-open on timeout, got %s", res.Verdict)
	}
	if res.FailOpenReason == "" {
		t.Error("expected fail-open reason string")
	}
}

func TestStreamChunkBlocksImmediately(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reply(w, "block", "profanity", []string{"profanity"})
	}))
	defer srv.Close()
	c := newClient(t, srv.URL)
	res := c.CheckChunk(context.Background(), Request{
		Direction:    DirectionStreamChunk,
		GuardrailIDs: []string{"prof"},
		Content:      RequestContent{Chunk: "offensive text"},
	})
	if res.Verdict != VerdictBlock {
		t.Fatalf("expected block, got %s", res.Verdict)
	}
}

func TestUpstream5xxReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	c := newClient(t, srv.URL)
	_, err := c.Check(context.Background(), Request{
		Direction:    DirectionRequest,
		GuardrailIDs: []string{"g1"},
	})
	if err == nil {
		t.Fatal("expected error on 503")
	}
}
