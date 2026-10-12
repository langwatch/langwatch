package mediarelay_test

// The pump of a hopped socket pair ends when one side ends. A pump that never
// returns holds the pod's Stop for its whole budget.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
)

// pumpSocketPair is a connected pair: the server side the pump holds and the
// client side the test drives.
func pumpSocketPair(t *testing.T) (server, client *websocket.Conn) {
	t.Helper()
	accepted := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled})
		if err != nil {
			return
		}
		accepted <- conn
	}))
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, _, err := websocket.Dial(ctx, srv.URL, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.CloseNow() })
	select {
	case server = <-accepted:
	case <-time.After(5 * time.Second):
		t.Fatal("the server never accepted the socket")
	}
	t.Cleanup(func() { _ = server.CloseNow() })
	return server, client
}

// drain reads until the socket ends, which lets a close handshake finish.
func drain(conn *websocket.Conn) {
	go func() {
		for {
			if _, _, err := conn.Read(context.Background()); err != nil {
				return
			}
		}
	}()
}

// @scenario "A hop pump returns when one side ends normally"
func TestPump_ReturnsPromptlyWhenOneSideClosesNormally(t *testing.T) {
	t.Parallel()
	hub := mediarelay.NewHub(mediarelay.Options{Secret: "pump-secret"})
	twilioSide, twilio := pumpSocketPair(t)
	ownerSide, owner := pumpSocketPair(t)
	drain(owner)
	drain(twilio)
	returned := make(chan struct{})
	go func() {
		hub.Pump(twilioSide, ownerSide)
		close(returned)
	}()

	go func() { _ = twilio.Close(websocket.StatusNormalClosure, "") }()

	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		assert.Fail(t, "pump did not return after one side closed normally")
	}
}
