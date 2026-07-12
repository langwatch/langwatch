package opencode

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// sinkStub is a minimal app.ChatSink capturing forwarded bytes, for the Stream
// delegation test.
type sinkStub struct{ strings.Builder }

func (s *sinkStub) Begin()                {}
func (s *sinkStub) ErrorEvent(msg string) {}
func (s *sinkStub) Flush()                {}

// endpointFor derives an app.Endpoint whose external port matches the test
// server's real listener, so port-keyed calls (OpenSession, WaitReady) hit it.
func endpointFor(t *testing.T, srv *httptest.Server) app.Endpoint {
	t.Helper()
	port := srv.Listener.Addr().(*net.TCPAddr).Port
	return app.Endpoint{
		BaseURL:      srv.URL,
		ExternalPort: port,
		InternalPort: port,
		BearerToken:  "b",
	}
}

// Agent.OpenSession must dial the EXTERNAL port (what CreateSession keys on); a
// slip to InternalPort would silently point sessions at the wrong listener.
func TestAgent_OpenSession_UsesExternalPortAndReturnsID(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"sess-xyz"}`))
	}))
	defer srv.Close()

	id, err := NewAgent(time.Second).OpenSession(context.Background(), endpointFor(t, srv))
	if err != nil {
		t.Fatalf("OpenSession: %v", err)
	}
	if id != "sess-xyz" {
		t.Errorf("session id = %q, want sess-xyz", id)
	}
	if gotPath != "/session" {
		t.Errorf("path = %q, want /session", gotPath)
	}
}

// Agent.Post must route the turn through ep.BaseURL and carry the Turn fields
// (system/prompt/resumeToken) onto the prompt_async body.
func TestAgent_Post_UsesBaseURLAndCarriesTurn(t *testing.T) {
	var gotPath string
	var body struct {
		System      string `json:"system"`
		ResumeToken string `json:"resumeToken"`
		Parts       []struct {
			Text string `json:"text"`
		} `json:"parts"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	ep := app.Endpoint{BaseURL: srv.URL, BearerToken: "b"}
	err := NewAgent(time.Second).Post(context.Background(), ep, "sess-1", app.Turn{
		System:      "sys",
		Prompt:      "hello",
		ResumeToken: "resume-1",
	})
	if err != nil {
		t.Fatalf("Post: %v", err)
	}
	if gotPath != "/session/sess-1/prompt_async" {
		t.Errorf("path = %q, want /session/sess-1/prompt_async", gotPath)
	}
	if body.System != "sys" || body.ResumeToken != "resume-1" {
		t.Errorf("body system/resume = %q/%q, want sys/resume-1", body.System, body.ResumeToken)
	}
	if len(body.Parts) != 1 || body.Parts[0].Text != "hello" {
		t.Errorf("parts = %+v, want single text 'hello'", body.Parts)
	}
}

// Agent.Stream must forward the session's events into the ChatSink.
func TestAgent_Stream_ForwardsSessionEventsToSink(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fl := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {\"type\":\"message.done\",\"sessionID\":\"sess-1\"}\n\n"))
		fl.Flush()
	}))
	defer srv.Close()

	var sink sinkStub
	ep := app.Endpoint{BaseURL: srv.URL, BearerToken: "b"}
	if err := NewAgent(time.Second).Stream(context.Background(), ep, "sess-1", &sink); err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if !strings.Contains(sink.String(), "\"type\":\"message.done\"") {
		t.Errorf("sink missing forwarded terminal event; got %q", sink.String())
	}
}
