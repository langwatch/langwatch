package controlplane

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/internal/frameauth"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

const testRunToken = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

var testIdentity = frameauth.Identity{
	ProjectID:      "proj_1",
	UserID:         "user_1",
	ConversationID: "conv_1",
	TurnID:         "turn_1",
}

// fakeRelay stands in for the TS Hono relay: it authenticates the bearer, reads
// the ndjson envelope stream, verifies each frame's HMAC against the runToken,
// and records the decoded payloads in order.
type fakeRelay struct {
	mu       sync.Mutex
	bearer   string
	payloads []string
	verified bool // every received frame passed frameauth.Verify
	status   int  // status to respond with (default 200)
}

func (r *fakeRelay) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("Authorization") != "Bearer "+r.bearer {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		r.mu.Lock()
		r.verified = true // starts true; a bad frame flips it false
		r.mu.Unlock()

		scanner := bufio.NewScanner(req.Body)
		for scanner.Scan() {
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}
			var env frameauth.Envelope
			if err := json.Unmarshal(line, &env); err != nil {
				r.mu.Lock()
				r.verified = false
				r.mu.Unlock()
				continue
			}
			ok := frameauth.Verify(testRunToken, env)
			r.mu.Lock()
			if !ok {
				r.verified = false
			}
			r.payloads = append(r.payloads, env.Payload)
			r.mu.Unlock()
		}

		if r.status != 0 {
			w.WriteHeader(r.status)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"applied": len(r.payloads)})
	}
}

// frame unwraps a frames.* constructor's (Frame, error) return so the two-value
// result can spread as the sole argument; a build error in a test is a panic.
func frame(f frames.Frame, err error) frames.Frame {
	if err != nil {
		panic(err)
	}
	return f
}

func TestRelayClient_SignsAndStreamsFramesInOrder(t *testing.T) {
	relay := &fakeRelay{bearer: "s3cr3t"}
	srv := httptest.NewServer(relay.handler())
	defer srv.Close()

	client := NewRelayClient("s3cr3t")
	stream, err := client.Open(context.Background(), srv.URL, testRunToken, testIdentity.ProjectID, testIdentity.UserID, testIdentity.ConversationID, testIdentity.TurnID)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	emit := []frames.Frame{
		frame(frames.Delta("hello ")),
		frame(frames.Delta("world")),
		frame(frames.Heartbeat()),
		frame(frames.Final("hello world", nil)),
	}
	for _, f := range emit {
		if err := stream.Emit(f); err != nil {
			t.Fatalf("Emit: %v", err)
		}
	}
	if err := stream.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	relay.mu.Lock()
	defer relay.mu.Unlock()
	if !relay.verified {
		t.Fatal("relay saw a frame whose HMAC did not verify against the runToken")
	}
	if len(relay.payloads) != len(emit) {
		t.Fatalf("relay got %d frames, want %d", len(relay.payloads), len(emit))
	}
	// Order is load-bearing (tokens/cards must land in sequence); assert it.
	for i, want := range []string{
		emit[0].JSON(), emit[1].JSON(), emit[2].JSON(), emit[3].JSON(),
	} {
		if relay.payloads[i] != want {
			t.Errorf("frame %d payload = %q, want %q", i, relay.payloads[i], want)
		}
	}
}

func TestRelayClient_CloseReportsNon2xx(t *testing.T) {
	relay := &fakeRelay{bearer: "s3cr3t", status: http.StatusServiceUnavailable}
	srv := httptest.NewServer(relay.handler())
	defer srv.Close()

	stream, err := NewRelayClient("s3cr3t").Open(context.Background(), srv.URL, testRunToken, testIdentity.ProjectID, testIdentity.UserID, testIdentity.ConversationID, testIdentity.TurnID)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := stream.Emit(frame(frames.Delta("x"))); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if err := stream.Close(); err == nil {
		t.Fatal("Close returned nil on a 503; want a status error")
	}
}

func TestRelayClient_OpenDisabledWithoutSecretEndpointOrToken(t *testing.T) {
	cases := []struct {
		name, secret, endpoint, runToken string
	}{
		{"no secret", "", "http://x", testRunToken},
		{"no endpoint", "s", "", testRunToken},
		{"no runToken", "s", "http://x", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewRelayClient(tc.secret).Open(context.Background(), tc.endpoint, tc.runToken, testIdentity.ProjectID, testIdentity.UserID, testIdentity.ConversationID, testIdentity.TurnID)
			if err != app.ErrRelayDisabled {
				t.Fatalf("Open err = %v, want app.ErrRelayDisabled", err)
			}
		})
	}
}

func TestRelayStream_EmitAfterCloseDropped(t *testing.T) {
	relay := &fakeRelay{bearer: "s3cr3t"}
	srv := httptest.NewServer(relay.handler())
	defer srv.Close()

	stream, err := NewRelayClient("s3cr3t").Open(context.Background(), srv.URL, testRunToken, testIdentity.ProjectID, testIdentity.UserID, testIdentity.ConversationID, testIdentity.TurnID)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := stream.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := stream.Emit(frame(frames.Delta("late"))); err != errStreamClosed {
		t.Fatalf("Emit after Close = %v, want errStreamClosed", err)
	}
}
