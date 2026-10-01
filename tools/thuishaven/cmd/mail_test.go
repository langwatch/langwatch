package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// stubMailSink is a minimal server implementing the pinned mailsim contract —
// just enough for the CLI's own HTTP calls and formatting to be proven with
// no real sink running.
func stubMailSink(t *testing.T, messages []mailSummary, full mailMessage) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/messages", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"messages": messages})
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		}
	})
	mux.HandleFunc("/api/messages/wait", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("subject") == "no-match" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(full)
	})
	mux.HandleFunc("/api/messages/missing", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"not_found"}`))
	})
	mux.HandleFunc("/api/messages/missing/html", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	mux.HandleFunc(fmt.Sprintf("/api/messages/%s", full.ID), func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(full)
	})
	mux.HandleFunc(fmt.Sprintf("/api/messages/%s/html", full.ID), func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(full.HTML))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func testMessage() mailMessage {
	return mailMessage{
		mailSummary: mailSummary{
			ID: "msg-1", From: "app@test.langwatch.localhost", To: []string{"dev@test.mail.langwatch.localhost"},
			Subject: "Verify your email", ReceivedAt: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC), SizeBytes: 512,
		},
		Text:  "click https://app.test.langwatch.localhost/verify?token=abc to verify",
		HTML:  "<p>click <a href=\"https://app.test.langwatch.localhost/verify?token=abc\">here</a></p>",
		Links: []string{"https://app.test.langwatch.localhost/verify?token=abc"},
	}
}

// @scenario "The inbox lists newest first"
func TestMailListPrintsEachMessage(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, []mailSummary{full.mailSummary}, full)
	out := captureStdout(t, func() {
		if err := runMailSubcommand(context.Background(), invocation{args: []string{"list"}}, false, srv.URL); err != nil {
			t.Fatalf("runMailSubcommand(list): %v", err)
		}
	})
	if !strings.Contains(out, "msg-1") || !strings.Contains(out, "Verify your email") {
		t.Errorf("list output = %q, want the message's id and subject", out)
	}
}

// @scenario "Every mail command has a machine-readable form"
func TestMailListJSON(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, []mailSummary{full.mailSummary}, full)
	out := captureStdout(t, func() {
		if err := runMailSubcommand(context.Background(), invocation{args: []string{"list"}}, true, srv.URL); err != nil {
			t.Fatalf("runMailSubcommand(list --json): %v", err)
		}
	})
	var decoded []mailSummary
	if err := json.Unmarshal([]byte(out), &decoded); err != nil {
		t.Fatalf("list --json did not decode: %v\noutput: %s", err, out)
	}
	if len(decoded) != 1 || decoded[0].ID != "msg-1" {
		t.Errorf("decoded = %+v, want the one stubbed message", decoded)
	}
}

// @scenario "One message can be read in full"
func TestMailGetPrintsHeadersTextAndLinks(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, nil, full)
	out := captureStdout(t, func() {
		if err := runMailSubcommand(context.Background(), invocation{args: []string{"get", "msg-1"}}, false, srv.URL); err != nil {
			t.Fatalf("runMailSubcommand(get): %v", err)
		}
	})
	if !strings.Contains(out, "click https://app.test.langwatch.localhost/verify?token=abc to verify") {
		t.Errorf("get output = %q, want the text body", out)
	}
	if !strings.Contains(out, "links:") || !strings.Contains(out, "https://app.test.langwatch.localhost/verify?token=abc") {
		t.Errorf("get output = %q, want the link listed on its own", out)
	}
}

// @scenario "One message can be read in full"
func TestMailGetHTML(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, nil, full)
	out := captureStdout(t, func() {
		if err := runMailSubcommand(context.Background(), invocation{args: []string{"get", "msg-1"}, flags: map[string]string{"--html": ""}}, false, srv.URL); err != nil {
			t.Fatalf("runMailSubcommand(get --html): %v", err)
		}
	})
	if !strings.Contains(out, "<a href=") {
		t.Errorf("get --html output = %q, want the raw HTML body", out)
	}
}

// @scenario "Asking for a message that does not exist is a refusal, not a stack trace"
func TestMailGetMissingIDRefuses(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, nil, full)
	err := runMailSubcommand(context.Background(), invocation{args: []string{"get", "missing"}}, false, srv.URL)
	if err == nil {
		t.Fatal("get on a missing id succeeded")
	}
	if !strings.Contains(err.Error(), "not in this stack's inbox") {
		t.Errorf("error = %q, want a plain refusal naming the missing message", err)
	}
}

// @scenario "A test can wait for a message to arrive"
func TestMailWaitPrintsTheMatch(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, nil, full)
	out := captureStdout(t, func() {
		if err := runMailSubcommand(context.Background(), invocation{args: []string{"wait"}}, false, srv.URL); err != nil {
			t.Fatalf("runMailSubcommand(wait): %v", err)
		}
	})
	if !strings.Contains(out, "Verify your email") {
		t.Errorf("wait output = %q, want the matched message", out)
	}
}

// @scenario "A test can wait for a message to arrive"
func TestMailWaitExitsNonZeroOnTimeout(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, nil, full)
	err := runMailSubcommand(context.Background(),
		invocation{args: []string{"wait"}, flags: map[string]string{"--subject": "no-match", "--timeout": "1ms"}},
		false, srv.URL)
	if err == nil {
		t.Fatal("wait succeeded although nothing matched")
	}
	if !strings.Contains(err.Error(), "no message matched") {
		t.Errorf("error = %q, want it to say nothing matched", err)
	}
}

// @scenario "The inbox can be emptied"
func TestMailClear(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, nil, full)
	out := captureStdout(t, func() {
		if err := runMailSubcommand(context.Background(), invocation{args: []string{"clear"}}, false, srv.URL); err != nil {
			t.Fatalf("runMailSubcommand(clear): %v", err)
		}
	})
	if !strings.Contains(out, "cleared") {
		t.Errorf("clear output = %q, want confirmation the inbox was cleared", out)
	}
}

// @scenario "Every mail command has a machine-readable form"
func TestMailClearJSON(t *testing.T) {
	full := testMessage()
	srv := stubMailSink(t, nil, full)
	out := captureStdout(t, func() {
		if err := runMailSubcommand(context.Background(), invocation{args: []string{"clear"}}, true, srv.URL); err != nil {
			t.Fatalf("runMailSubcommand(clear --json): %v", err)
		}
	})
	var decoded map[string]bool
	if err := json.Unmarshal([]byte(out), &decoded); err != nil {
		t.Fatalf("clear --json did not decode: %v\noutput: %s", err, out)
	}
	if !decoded["cleared"] {
		t.Errorf("decoded = %+v, want cleared: true", decoded)
	}
}

func TestMailUnknownSubcommandRefusesByName(t *testing.T) {
	err := runMailSubcommand(context.Background(), invocation{args: []string{"bogus"}}, false, "http://127.0.0.1:0")
	if err == nil || !strings.Contains(err.Error(), `"bogus"`) {
		t.Errorf("error = %v, want it to name the unknown subcommand", err)
	}
}
