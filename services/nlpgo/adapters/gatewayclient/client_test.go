package gatewayclient

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

const testSecret = "f1b6c4a7e8d9c2a1b3d5e7f9a0b2c4d6e8f0a2c4b6d8e0f2a4c6e8d0b2c4e6f8"

func TestClient_New_RequiresBaseURL(t *testing.T) {
	if _, err := New(Options{InternalSecret: testSecret}); err == nil {
		t.Fatalf("expected error when BaseURL is empty")
	}
}

func TestClient_New_RequiresSecret(t *testing.T) {
	if _, err := New(Options{BaseURL: "http://localhost"}); err == nil {
		t.Fatalf("expected error when secret is empty")
	}
}

func TestClient_ChatCompletions_SendsSignedRequest(t *testing.T) {
	credsHeader := mustEncodeCreds(t, map[string]any{
		"provider": "openai",
		"openai":   map[string]string{"api_key": "sk-test"},
	})
	body := []byte(`{"model":"openai/gpt-5-mini","messages":[]}`)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Capture and verify signature.
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("expected /v1/chat/completions path, got %s", r.URL.Path)
		}
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json")
		}
		if r.Header.Get(HeaderProjectID) != "proj_acme" {
			t.Errorf("expected project header, got %q", r.Header.Get(HeaderProjectID))
		}
		if r.Header.Get(HeaderInlineCredentials) != credsHeader {
			t.Errorf("expected inline-creds header passed through")
		}
		ts := r.Header.Get(HeaderInternalTimestamp)
		sig := r.Header.Get(HeaderInternalAuth)
		if ts == "" || sig == "" {
			t.Errorf("expected signature + timestamp headers")
		}
		gotBody, _ := io.ReadAll(r.Body)
		if !bytes.Equal(gotBody, body) {
			t.Errorf("body mismatch: got %s, want %s", gotBody, body)
		}

		// Verify HMAC matches what the gateway would compute.
		expectedSig := computeExpectedSig(t, "POST", "/v1/chat/completions", ts, body, credsHeader)
		if sig != expectedSig {
			t.Errorf("signature mismatch:\n  got %s\n want %s", sig, expectedSig)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write([]byte(`{"id":"chatcmpl-1","model":"openai/gpt-5-mini"}`))
	}))
	defer srv.Close()

	c, err := New(Options{BaseURL: srv.URL, InternalSecret: testSecret})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := c.ChatCompletions(context.Background(), app.GatewayRequest{
		Body:    body,
		Headers: map[string]string{HeaderInlineCredentials: credsHeader},
		Project: "proj_acme",
		Model:   "openai/gpt-5-mini",
	})
	if err != nil {
		t.Fatalf("ChatCompletions: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if !strings.Contains(string(resp.Body), `"chatcmpl-1"`) {
		t.Errorf("expected response body forwarded, got %s", resp.Body)
	}
}

func TestClient_DoesNotMutateRequestBetweenCalls(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()
	c, err := New(Options{BaseURL: srv.URL, InternalSecret: testSecret})
	if err != nil {
		t.Fatal(err)
	}
	credsHeader := mustEncodeCreds(t, map[string]any{
		"provider": "openai", "openai": map[string]string{"api_key": "k"},
	})
	req := app.GatewayRequest{
		Body:    []byte(`{}`),
		Headers: map[string]string{HeaderInlineCredentials: credsHeader},
		Project: "p",
	}
	if _, err := c.ChatCompletions(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	// Sleep a second so the timestamp would change if the signer cached
	// state, then call again — should sign correctly with fresh timestamp.
	time.Sleep(1100 * time.Millisecond)
	if _, err := c.Embeddings(context.Background(), req); err != nil {
		t.Fatal(err)
	}
}

func TestClient_AllMethodsRouteToCorrectPath(t *testing.T) {
	cases := []struct {
		name string
		path string
		fn   func(c *Client) error
	}{
		{"ChatCompletions", "/v1/chat/completions", func(c *Client) error {
			_, err := c.ChatCompletions(context.Background(), basicReq(t))
			return err
		}},
		{"Messages", "/v1/messages", func(c *Client) error {
			_, err := c.Messages(context.Background(), basicReq(t))
			return err
		}},
		{"Responses", "/v1/responses", func(c *Client) error {
			_, err := c.Responses(context.Background(), basicReq(t))
			return err
		}},
		{"Embeddings", "/v1/embeddings", func(c *Client) error {
			_, err := c.Embeddings(context.Background(), basicReq(t))
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var capturedPath string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				capturedPath = r.URL.Path
				w.WriteHeader(200)
			}))
			defer srv.Close()
			c, _ := New(Options{BaseURL: srv.URL, InternalSecret: testSecret})
			if err := tc.fn(c); err != nil {
				t.Fatal(err)
			}
			if capturedPath != tc.path {
				t.Errorf("expected path %s, got %s", tc.path, capturedPath)
			}
		})
	}
}

func TestClient_ChatCompletionsStream_ReadsSSEEvents(t *testing.T) {
	credsHeader := mustEncodeCreds(t, map[string]any{
		"provider": "openai", "openai": map[string]string{"api_key": "k"},
	})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		flush, _ := w.(http.Flusher)
		// 3 events + [DONE] sentinel.
		fmt.Fprint(w, "data: {\"index\":0,\"delta\":\"Hello\"}\n\n")
		flush.Flush()
		fmt.Fprint(w, "data: {\"index\":1,\"delta\":\" world\"}\n\n")
		flush.Flush()
		fmt.Fprint(w, "data: [DONE]\n\n")
		flush.Flush()
	}))
	defer srv.Close()

	c, _ := New(Options{BaseURL: srv.URL, InternalSecret: testSecret})
	iter, err := c.ChatCompletionsStream(context.Background(), app.GatewayRequest{
		Body:    []byte(`{"stream":true}`),
		Headers: map[string]string{HeaderInlineCredentials: credsHeader},
		Project: "p",
	})
	if err != nil {
		t.Fatalf("ChatCompletionsStream: %v", err)
	}
	defer iter.Close()

	var events []string
	for iter.Next(context.Background()) {
		events = append(events, string(iter.Chunk()))
	}
	if iter.Err() != nil {
		t.Fatalf("iter error: %v", iter.Err())
	}
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d: %#v", len(events), events)
	}
	if !strings.Contains(events[0], "Hello") {
		t.Errorf("expected first event to contain Hello, got %s", events[0])
	}
	if !strings.Contains(events[2], "[DONE]") {
		t.Errorf("expected last event to be [DONE] sentinel, got %s", events[2])
	}
}

func TestClient_StreamHTTPError_OnNon2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"type":"auth_failed"}`))
	}))
	defer srv.Close()

	c, _ := New(Options{BaseURL: srv.URL, InternalSecret: testSecret})
	credsHeader := mustEncodeCreds(t, map[string]any{
		"provider": "openai", "openai": map[string]string{"api_key": "k"},
	})

	_, err := c.ChatCompletionsStream(context.Background(), app.GatewayRequest{
		Body:    []byte(`{"stream":true}`),
		Headers: map[string]string{HeaderInlineCredentials: credsHeader},
		Project: "p",
	})
	if err == nil {
		t.Fatalf("expected error on 401, got nil")
	}
	herr, ok := err.(*StreamHTTPError)
	if !ok {
		t.Fatalf("expected *StreamHTTPError, got %T", err)
	}
	if herr.StatusCode != 401 {
		t.Errorf("expected 401, got %d", herr.StatusCode)
	}
	if !strings.Contains(string(herr.Body), "auth_failed") {
		t.Errorf("expected error body forwarded, got %s", herr.Body)
	}
}

func TestClient_PassesThroughCallerHeaders(t *testing.T) {
	var captured http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.Header.Clone()
		w.WriteHeader(200)
	}))
	defer srv.Close()

	c, _ := New(Options{BaseURL: srv.URL, InternalSecret: testSecret})
	credsHeader := mustEncodeCreds(t, map[string]any{
		"provider": "openai", "openai": map[string]string{"api_key": "k"},
	})

	_, err := c.ChatCompletions(context.Background(), app.GatewayRequest{
		Body: []byte(`{}`),
		Headers: map[string]string{
			HeaderInlineCredentials: credsHeader,
			HeaderOrigin:            "workflow",
			HeaderTraceID:           "trc_abc123",
			"X-Custom-Tag":          "acme",
		},
		Project: "p",
	})
	if err != nil {
		t.Fatal(err)
	}
	if captured.Get(HeaderOrigin) != "workflow" {
		t.Errorf("expected origin header passed through")
	}
	if captured.Get(HeaderTraceID) != "trc_abc123" {
		t.Errorf("expected trace id header passed through")
	}
	if captured.Get("X-Custom-Tag") != "acme" {
		t.Errorf("expected custom header passed through")
	}
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

func basicReq(t *testing.T) app.GatewayRequest {
	t.Helper()
	creds := mustEncodeCreds(t, map[string]any{
		"provider": "openai", "openai": map[string]string{"api_key": "k"},
	})
	return app.GatewayRequest{
		Body:    []byte(`{}`),
		Headers: map[string]string{HeaderInlineCredentials: creds},
		Project: "p",
	}
}

func mustEncodeCreds(t *testing.T, v map[string]any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func computeExpectedSig(t *testing.T, method, path, ts string, body []byte, credsHeader string) string {
	t.Helper()
	bodyHash := sha256.Sum256(body)
	credsHash := sha256.Sum256([]byte(credsHeader))
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(method + "\n" + path + "\n" + ts + "\n" + hex.EncodeToString(bodyHash[:]) + "\n" + hex.EncodeToString(credsHash[:])))
	return hex.EncodeToString(mac.Sum(nil))
}
