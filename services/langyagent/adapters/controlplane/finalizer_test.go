package controlplane

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

func TestFinalizer_PostsTurnResultWithAuthAndPath(t *testing.T) {
	var gotPath, gotAuth, gotContentType string
	var gotBody app.TurnResult
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotContentType = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(202)
	}))
	defer srv.Close()

	f := NewFinalizer("s3cr3t", 0)
	err := f.Finalize(context.Background(), srv.URL, "turn-123", app.TurnResult{
		ProjectID:      "proj-1",
		ConversationID: "conv-1",
		Status:         "completed",
		Text:           "hello",
	})
	if err != nil {
		t.Fatalf("Finalize returned error: %v", err)
	}
	if gotPath != "/api/internal/langy/turn/turn-123/result" {
		t.Errorf("path = %q, want /api/internal/langy/turn/turn-123/result", gotPath)
	}
	if gotAuth != "Bearer s3cr3t" {
		t.Errorf("auth = %q, want Bearer s3cr3t", gotAuth)
	}
	if gotContentType != "application/json" {
		t.Errorf("content-type = %q", gotContentType)
	}
	if gotBody.ProjectID != "proj-1" || gotBody.ConversationID != "conv-1" ||
		gotBody.Status != "completed" || gotBody.Text != "hello" {
		t.Errorf("body = %+v", gotBody)
	}
}

func TestFinalizer_RetriesOn5xxThenSucceeds(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.WriteHeader(503) // transient — retryable
			return
		}
		w.WriteHeader(202)
	}))
	defer srv.Close()

	f := NewFinalizer("s3cr3t", 0)
	err := f.Finalize(context.Background(), srv.URL, "turn-1", app.TurnResult{
		ProjectID:      "p",
		ConversationID: "c",
		Status:         "completed",
	})
	if err != nil {
		t.Fatalf("Finalize returned error after retry: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("attempts = %d, want 2 (one 503 then success)", got)
	}
}

func TestFinalizer_DoesNotRetryOn4xx(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(400) // our own bug — never succeeds on retry
	}))
	defer srv.Close()

	f := NewFinalizer("s3cr3t", 0)
	err := f.Finalize(context.Background(), srv.URL, "turn-1", app.TurnResult{
		ProjectID:      "p",
		ConversationID: "c",
		Status:         "completed",
	})
	if err == nil {
		t.Fatal("expected an error on a permanent 4xx")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("attempts = %d, want 1 (4xx is not retried)", got)
	}
}

func TestFinalizer_NoOpWhenMissingRequiredArgs(t *testing.T) {
	var called int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&called, 1)
		w.WriteHeader(202)
	}))
	defer srv.Close()

	f := NewFinalizer("s3cr3t", 0)
	base := app.TurnResult{ProjectID: "p", ConversationID: "c", Status: "completed"}

	// Each missing required input makes it a no-op (never breaks a finished turn).
	cases := []struct {
		name     string
		endpoint string
		turnID   string
		result   app.TurnResult
	}{
		{"no endpoint", "", "t1", base},
		{"no turnID", srv.URL, "", base},
		{"no projectId", srv.URL, "t1", app.TurnResult{ConversationID: "c", Status: "completed"}},
		{"no conversationId", srv.URL, "t1", app.TurnResult{ProjectID: "p", Status: "completed"}},
	}
	for _, tc := range cases {
		if err := f.Finalize(context.Background(), tc.endpoint, tc.turnID, tc.result); err != nil {
			t.Errorf("%s: expected no-op nil, got %v", tc.name, err)
		}
	}
	if got := atomic.LoadInt32(&called); got != 0 {
		t.Errorf("server called %d times, want 0", got)
	}

	// A nil finalizer and an empty secret are also no-ops.
	var nilF *Finalizer
	if err := nilF.Finalize(context.Background(), srv.URL, "t1", base); err != nil {
		t.Errorf("nil finalizer: got %v", err)
	}
	if err := NewFinalizer("", 0).Finalize(context.Background(), srv.URL, "t1", base); err != nil {
		t.Errorf("empty secret: got %v", err)
	}
}
