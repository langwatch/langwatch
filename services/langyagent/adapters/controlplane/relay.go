package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/internal/frameauth"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// Compile-time proof the relay client + stream satisfy the app ports.
var (
	_ app.FrameRelay  = (*RelayClient)(nil)
	_ app.FrameStream = (*RelayStream)(nil)
)

// RelayClient pushes a turn's signed output frames to the control-plane relay
// (POST /api/internal/langy/relay/frames) as ONE long-lived ndjson stream — the
// self-drive successor to holding the /chat response open (LANGY_WORKER_REDESIGN
// §0/§0b). The manager is the SOLE signer: it SIGNS each frame with the
// conversation's runToken (frameauth) before it leaves the process, so the relay
// can verify possession without the secret ever crossing the wire. opencode never
// holds the runToken and never reaches the relay.
//
// One RelayClient is shared; each turn Opens its own RelayStream (the worker holds
// one connection per turn — the load balancer pins it, keeping frames in order).
// Uses the SAME shared LANGY_INTERNAL_SECRET as the Finalizer/Revoker — this
// direction needs no new credential.
type RelayClient struct {
	client         *http.Client
	internalSecret string
}

// NewRelayClient builds a RelayClient. It deliberately uses a client with NO
// Timeout: a turn's stream is open for the whole turn, so a client-level deadline
// would kill long answers. Cancellation is the caller's ctx instead (a turn
// cancel or a client disconnect aborts the push).
func NewRelayClient(internalSecret string) *RelayClient {
	return &RelayClient{
		client:         &http.Client{},
		internalSecret: internalSecret,
	}
}

// errStreamClosed is returned by Emit after Close — a frame arriving late (e.g. a
// heartbeat racing teardown) is dropped, not written to a closed pipe.
var errStreamClosed = errors.New("controlplane: relay stream already closed")

// Open starts one relay connection for a turn (satisfies app.FrameRelay). endpoint
// is the LangwatchEndpoint the turn was spawned with; runToken is the
// conversation's frameauth secret; the {project,user,conversation,turn} tuple binds
// every frame on this stream. Frames written via the returned stream are signed and
// pushed in order; Close ends the stream. Returns app.ErrRelayDisabled (never a
// hard failure) when the push cannot run.
func (c *RelayClient) Open(ctx context.Context, endpoint, runToken, projectID, userID, conversationID, turnID string) (app.FrameStream, error) {
	if c == nil || c.internalSecret == "" || strings.TrimSpace(endpoint) == "" || runToken == "" {
		return nil, app.ErrRelayDisabled
	}
	id := frameauth.Identity{
		ProjectID:      projectID,
		UserID:         userID,
		ConversationID: conversationID,
		TurnID:         turnID,
	}
	target := strings.TrimRight(endpoint, "/") + "/api/internal/langy/relay/frames"

	// A pipe body turns the request into a live stream: whatever Emit writes to pw
	// is read off pr by the in-flight POST and forwarded to the relay. The request
	// completes only when pw is closed (Close), so client.Do runs in a goroutine.
	pr, pw := io.Pipe()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, pr)
	if err != nil {
		_ = pw.Close()
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	req.Header.Set("Authorization", "Bearer "+c.internalSecret)

	s := &RelayStream{runToken: runToken, id: id, pw: pw, done: make(chan error, 1)}
	go func() {
		resp, err := c.client.Do(req)
		if err != nil {
			// Unblock any Emit parked on pw.Write, then report the failure.
			_ = pr.CloseWithError(err)
			s.done <- err
			return
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, resp.Body) // drain the tally so the conn can be reused
		if resp.StatusCode >= 300 {
			s.done <- &httpStatusError{status: resp.StatusCode}
			return
		}
		s.done <- nil
	}()
	return s, nil
}

// RelayStream is one turn's push connection to the relay. Emit is safe to call
// from the stream goroutine and the heartbeat goroutine concurrently (a single
// write mutex serialises lines, exactly like the in-band writeMu it replaces).
type RelayStream struct {
	runToken string
	id       frameauth.Identity
	pw       *io.PipeWriter
	done     chan error

	mu     sync.Mutex
	closed bool
}

// Emit signs one frame with the turn's runToken + identity (minting a fresh
// frameNonce) and writes it as one ndjson line. A marshal/sign failure is
// returned but is best-effort at the call site — a dropped ephemeral frame must
// never fail the turn. Returns errStreamClosed if called after Close.
func (s *RelayStream) Emit(f frames.Frame) error {
	env, err := f.Sign(s.runToken, s.id)
	if err != nil {
		return err
	}
	line, err := json.Marshal(env)
	if err != nil {
		return err
	}
	line = append(line, '\n')

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errStreamClosed
	}
	_, werr := s.pw.Write(line)
	return werr
}

// Close ends the stream (EOF on the body → the POST completes) and waits for the
// relay's response, returning a non-nil error only on a transport failure or a
// non-2xx status. Idempotent. Safe to call from a defer.
func (s *RelayStream) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()

	_ = s.pw.Close() // EOF → request body ends → relay responds on s.done
	return <-s.done
}
