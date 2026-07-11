package workerpool

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// terminalEventTypes are the SSE event types that close the per-turn stream:
// once we see one of these, the worker is done producing this turn's output and
// we stop forwarding to the client.
var terminalEventTypes = map[string]struct{}{
	"message.completed": {},
	"message.done":      {},
	"session.idle":      {},
	"session.completed": {},
	"error":             {},
}

// errAuthProbeUnreachable marks a transport-level failure of the auth
// enforcement probe (opencode's internal listener not up yet, a connection
// reset). It is retryable — waitForReadiness keeps polling. A definite non-401
// *status* is NOT this error: that's a real security failure and fails closed.
// Kept as an internal sentinel (not a herr code): it never leaves the pool, it
// only classifies a retry inside waitForReadiness.
var errAuthProbeUnreachable = errors.New("opencode-auth-probe-unreachable")

// httpClient is reused across all opencode calls. opencode binds 127.0.0.1 per
// worker; we only ever talk to localhost. A long stream timeout would truncate
// generations, so the read deadline is per-request.
var httpClient = &http.Client{Transport: &http.Transport{
	MaxIdleConnsPerHost: 4,
	IdleConnTimeout:     30 * time.Second,
}}

// sseEvent is the minimal typed view of an opencode /event line — just enough
// to route the event to its session and detect the terminal type. Decoding into
// this struct (instead of map[string]any) skips unknown fields with no boxed-any
// allocation, so the streaming hot path is strictly faster and lighter on GC.
// The raw payload is still forwarded VERBATIM to the client; this struct is used
// ONLY for routing + terminal detection. The duplicated session fields cover the
// key OpenCode has emitted across versions.
type sseEvent struct {
	Type              string `json:"type"`
	SessionID         string `json:"sessionID"`
	SessionId         string `json:"sessionId"`
	SessionUnderscore string `json:"session_id"`
	Properties        struct {
		SessionID string `json:"sessionID"`
		SessionId string `json:"sessionId"`
	} `json:"properties"`
}

// addBearer attaches the per-worker bearer token to an outgoing request. Every
// helper in this file routes through the authProxy on port and so must carry
// the token; an empty token here would surface as a 401 from the authproxy,
// which is the correct fail-closed shape — better an early 401 than a silent
// missing header.
func addBearer(req *http.Request, bearerToken string) {
	req.Header.Set("Authorization", "Bearer "+bearerToken)
}

// getFreePort asks the kernel for an ephemeral port and returns it after
// closing the listener. There is a brief race window between Close() and
// opencode binding the port, but it is short enough in practice (and opencode's
// listen() retries the SO_REUSEADDR socket).
func getFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	return port, nil
}

// waitForReadiness polls the worker until its opencode is both listening AND
// enforcing auth. It runs two probes CONCURRENTLY each cycle — both must pass:
//
//   - The external probe (probeExternalReady) hits the authProxy root. opencode
//     answers 404 on /, which is fine — any HTTP status means the server is
//     listening. Connection refused / transport error is the "not yet" state we
//     poll through. One exception: 502 from the proxy is authproxy.go's own
//     rev.ErrorHandler reporting that opencode's listener isn't up yet.
//     startAuthProxy binds and serves synchronously, but opencode is a separate
//     process that takes real time to start listening — the proxy answers 502 to
//     every poll in that window. Treating that as "ready" would race the auth
//     probe against a backend that isn't there yet (it always loses in
//     production, since the proxy is always first). So we keep polling THROUGH
//     502 the same way we poll through a transport error.
//
//   - The internal probe (requireOpenCodeAuthEnforced) requires opencode's
//     control port to actually enforce OPENCODE_SERVER_PASSWORD (ADR-033 Fix A′
//     fail-closed guard). The sibling-isolation guarantee this whole design
//     rests on lives in that enforcement; if it's ever not there, the worker
//     must not start. A definite non-401 fails the spawn closed; a transport
//     failure is retryable.
//
// The cadence is an adaptive backoff — start tight (opencode is usually ready in
// tens of ms), grow to a 100ms cap — driven by a single reused timer.
func waitForReadiness(ctx context.Context, externalPort, internalPort int, bearerToken string, deadline time.Duration) error {
	dl := time.Now().Add(deadline)
	backoff := 10 * time.Millisecond
	const maxBackoff = 100 * time.Millisecond
	timer := time.NewTimer(backoff)
	defer timer.Stop()

	for time.Now().Before(dl) {
		var extReady bool
		var authErr error
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			defer clog.HandlePanic(ctx, false)
			extReady = probeExternalReady(ctx, externalPort, bearerToken)
		}()
		go func() {
			defer wg.Done()
			defer clog.HandlePanic(ctx, false)
			authErr = requireOpenCodeAuthEnforced(ctx, internalPort)
		}()
		wg.Wait()

		// A definite non-401 from the control endpoint is a security verdict —
		// fail closed immediately regardless of the external probe. A transport
		// failure (errAuthProbeUnreachable) is retryable.
		if authErr != nil && !errors.Is(authErr, errAuthProbeUnreachable) {
			return authErr
		}
		if extReady && authErr == nil {
			return nil
		}

		// Not ready — sleep the current backoff on the reused timer, then grow it.
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
		if backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
	// The port + timeout are internal diagnostics — logged, never surfaced in
	// the handled error the customer sees.
	clog.Get(ctx).Warn("worker readiness timeout",
		zap.Int("external_port", externalPort),
		zap.Duration("timeout", deadline),
	)
	return herr.New(ctx, domain.ErrWorkerNotReady, herr.M{
		"message": "the assistant took too long to start, please try again",
	})
}

// probeExternalReady reports whether the authProxy answers with any non-502
// status. 502 is authproxy.go's ErrorHandler reporting opencode's listener isn't
// up yet (the poll-through-502 gate); a transport error is "not up yet" too.
func probeExternalReady(ctx context.Context, externalPort int, bearerToken string) bool {
	reqCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	url := fmt.Sprintf("http://127.0.0.1:%d/", externalPort)
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	addBearer(req, bearerToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		return false
	}
	status := resp.StatusCode
	_ = resp.Body.Close()
	return status != http.StatusBadGateway
}

// requireOpenCodeAuthEnforced is the Fix A′ fail-closed guard: an
// unauthenticated request to a real opencode CONTROL endpoint must be rejected
// with 401. We probe `POST /session` — the create-session call a sibling would
// use to hijack a worker — rather than just `GET /`. The production risk this
// design closes is direct sibling access to the control API (POST /session,
// /session/{id}/prompt_async, /event), so proving the root route is protected
// isn't enough: if opencode ever moved to per-route auth where `/` stays 401
// while `/session` is reachable, a bare `GET /` probe would be fooled and the
// worker would start with its control plane exposed. Anything other than 401
// here means OPENCODE_SERVER_PASSWORD isn't gating the control API; the caller
// must not let the worker serve traffic in that state.
//
// Return contract:
//   - nil                                    — 401: auth is enforced.
//   - error wrapping errAuthProbeUnreachable  — transport failure: retryable.
//   - herr(ErrOpenCodeAuthNotEnforced)        — a definite non-401 response: fail closed.
func requireOpenCodeAuthEnforced(ctx context.Context, internalPort int) error {
	reqCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	url := fmt.Sprintf("http://127.0.0.1:%d/session", internalPort)
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewBufferString(`{"title":"auth-probe"}`))
	if err != nil {
		return fmt.Errorf("build auth-enforcement probe: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		// Listener not up yet / reset — retryable, not a security verdict.
		return fmt.Errorf("%w: %v", errAuthProbeUnreachable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		// The exact status + port are internal security diagnostics — logged for
		// operators, never surfaced in the handled error (nothing the customer
		// needs beyond "it couldn't start securely, retry"). This is a
		// deliberately-handled fail-closed condition, so it is a herr, not a
		// plain error.
		clog.Get(ctx).Warn("opencode did not enforce auth on control endpoint — refusing to start worker unsecured",
			zap.Int("internal_port", internalPort),
			zap.Int("got_status", resp.StatusCode),
			zap.Int("want_status", http.StatusUnauthorized),
		)
		return herr.New(ctx, domain.ErrOpenCodeAuthNotEnforced, herr.M{
			"message": "the assistant could not start securely, please try again",
		})
	}
	return nil
}

// createOpenCodeSession posts a fresh session to the worker. Returns the
// session id we route subsequent prompts to.
func createOpenCodeSession(ctx context.Context, port int, bearerToken string) (string, error) {
	body := bytes.NewBufferString(`{"title":"langy"}`)
	url := fmt.Sprintf("http://127.0.0.1:%d/session", port)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	addBearer(req, bearerToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("create session: %d %s", resp.StatusCode, string(b))
	}
	var out struct {
		ID      string `json:"id"`
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("create session: decode: %w", err)
	}
	if out.ID != "" {
		return out.ID, nil
	}
	return out.Session.ID, nil
}

// postMessage queues a turn for the worker. 204/2xx → success. 404 means the
// session vanished (rare; surfaces as domain.ErrSessionNotFound so the
// orchestrator can recycle the worker). baseURL is the worker's precomputed
// "http://127.0.0.1:<port>" so no per-turn Sprintf is needed.
func postMessage(ctx context.Context, baseURL, bearerToken, sessionID, system, userText string) error {
	type part struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	payload := struct {
		Parts  []part `json:"parts"`
		System string `json:"system,omitempty"`
	}{
		Parts:  []part{{Type: "text", Text: userText}},
		System: system,
	}
	body, _ := json.Marshal(payload)
	url := baseURL + "/session/" + sessionID + "/prompt_async"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	addBearer(req, bearerToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		// Expected, handled recycle signal on the hot path — no stack capture.
		return herr.NewLight(ctx, domain.ErrSessionNotFound, nil)
	}
	if resp.StatusCode >= 400 && resp.StatusCode != http.StatusNoContent {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("post message: %d %s", resp.StatusCode, string(b))
	}
	return nil
}

// streamSessionEvents tails /event from the worker and forwards every event
// belonging to sessionID as one ndjson line to w. Returns when a terminal event
// lands or the context is cancelled. The fetch carries the same ctx so a client
// disconnect aborts the upstream socket immediately — opencode would otherwise
// hold it open until it had something to send. baseURL is the worker's
// precomputed "http://127.0.0.1:<port>".
//
// Performance: it reads with scanner.Bytes() (no per-line string alloc), routes
// via the typed sseEvent, and writes each forwarded event through ONE reused
// scratch buffer — so a whole turn allocates a single write buffer instead of
// one per event.
func streamSessionEvents(ctx context.Context, baseURL, bearerToken, sessionID string, w io.Writer, flush func()) error {
	url := baseURL + "/event"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	addBearer(req, bearerToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		// Client disconnect: ctx.Err() is what we want to surface.
		if ctx.Err() != nil {
			return nil
		}
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("event stream failed: %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	dataPrefix := []byte("data:")
	var out []byte // reused across the whole stream: one alloc/turn, not one/event
	var ev sseEvent
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if !bytes.HasPrefix(line, dataPrefix) {
			continue
		}
		payload := bytes.TrimSpace(line[len(dataPrefix):])
		if len(payload) == 0 {
			continue
		}
		// Reset before decode: json.Unmarshal leaves fields absent from THIS event
		// at their previous values, which would misroute a following event.
		ev = sseEvent{}
		if err := json.Unmarshal(payload, &ev); err != nil {
			continue
		}
		if !eventBelongsToSession(&ev, sessionID) {
			continue
		}
		// Forward the payload VERBATIM, newline-terminated. payload aliases the
		// scanner buffer (valid only until the next Scan); appending into out
		// copies it out before Write.
		out = append(out[:0], payload...)
		out = append(out, '\n')
		if _, err := w.Write(out); err != nil {
			return nil // client disconnect — opencode keeps producing, but we're done.
		}
		if flush != nil {
			flush()
		}
		if _, terminal := terminalEventTypes[ev.Type]; terminal {
			return nil
		}
	}
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return err
	}
	return nil
}

// eventBelongsToSession extracts the session id from any of the shapes OpenCode
// has emitted across versions. If none match the routed session, the event
// belongs to a different worker's session and we skip it. The first non-empty
// session id decides routing — the same precedence the map-based version used.
func eventBelongsToSession(ev *sseEvent, sessionID string) bool {
	if sessionID == "" {
		return false
	}
	for _, v := range []string{
		ev.SessionID, ev.SessionId, ev.SessionUnderscore,
		ev.Properties.SessionID, ev.Properties.SessionId,
	} {
		if v != "" {
			return v == sessionID
		}
	}
	return false
}
