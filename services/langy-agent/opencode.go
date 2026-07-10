package langyagent

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
	"strings"
	"time"
)

// terminalEventTypes are the SSE event types that close the per-turn stream:
// once we see one of these, the worker is done producing this turn's output
// and we stop forwarding to the client.
var terminalEventTypes = map[string]struct{}{
	"message.completed": {},
	"message.done":      {},
	"session.idle":      {},
	"session.completed": {},
	"error":             {},
}

// sessionNotFoundError marks the case where the worker's OpenCode internal
// session vanished mid-turn — handler.go uses errors.Is to kill the worker
// and surface a typed error to the caller.
var errSessionNotFound = errors.New("opencode-session-not-found")

// httpClient is reused across all opencode calls. opencode binds 127.0.0.1
// per worker; we only ever talk to localhost. A long stream timeout would
// truncate generations, so the read deadline is per-request.
var httpClient = &http.Client{Transport: &http.Transport{
	MaxIdleConnsPerHost: 4,
	IdleConnTimeout:     30 * time.Second,
}}

// addBearer attaches the per-worker bearer token to an outgoing request.
// Every helper in this file routes through the authProxy on port and so
// must carry the token; an empty token here would surface as a 401 from
// the authproxy, which is the correct fail-closed shape — better an early
// 401 than a silent missing header.
func addBearer(req *http.Request, bearerToken string) {
	req.Header.Set("Authorization", "Bearer "+bearerToken)
}

// getFreePort asks the kernel for an ephemeral port and returns it after
// closing the listener. There is a brief race window between Close() and
// opencode binding the port, but it is short enough in practice (and
// opencode's listen() retries the SO_REUSEADDR socket).
func getFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	return port, nil
}

// waitForReadiness polls the worker's HTTP root until any response comes
// back. opencode answers 404 on /, which is fine — any HTTP status means
// the server is listening. Connection refused is the "not yet" state we
// keep polling through.
//
// Probed via the authProxy port so a successful poll also proves the
// proxy chain is wired correctly. 401 from the proxy counts as ready
// (the proxy is up); we treat it as a non-error status code along with
// 2xx/3xx/4xx — anything other than transport failure means a listener
// answered.
//
// One exception: 502 from the proxy is not readiness, it's
// authproxy.go's own rev.ErrorHandler reporting that opencode's listener
// isn't up yet. startAuthProxy binds and starts serving synchronously,
// but opencode is a separate process that takes real time to start
// listening — the proxy answers 502 to every poll in that window. Treating
// that as "ready" would immediately race requireOpenCodeAuthEnforced below
// against a backend that isn't there yet (it always loses in production,
// since the proxy is always first). So we keep polling through 502 the
// same way we poll through a transport error.
//
// Once the proxy chain answers with something other than 502, this
// additionally requires opencode's internal port to actually enforce
// OPENCODE_SERVER_PASSWORD (ADR-033 Fix A′ fail-closed guard) — see
// requireOpenCodeAuthEnforced. The sibling-isolation guarantee this PR
// adds rests entirely on that enforcement; if it's ever not there, the
// worker must not start.
func waitForReadiness(ctx context.Context, externalPort, internalPort int, bearerToken string, deadline time.Duration) error {
	dl := time.Now().Add(deadline)
	url := fmt.Sprintf("http://127.0.0.1:%d/", externalPort)
	for time.Now().Before(dl) {
		reqCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
		addBearer(req, bearerToken)
		resp, err := httpClient.Do(req)
		if err == nil {
			status := resp.StatusCode
			_ = resp.Body.Close()
			cancel()
			if status != http.StatusBadGateway {
				// Proxy chain answers → verify opencode actually enforces the
				// password on its control API. A transport error on the
				// internal probe (opencode's listener still coming up, a
				// reset) is retryable — keep polling. Only a definite non-401
				// *response* from the control endpoint fails the spawn closed.
				authErr := requireOpenCodeAuthEnforced(ctx, internalPort)
				if authErr == nil {
					return nil
				}
				if !errors.Is(authErr, errAuthProbeUnreachable) {
					return authErr
				}
			}
		} else {
			cancel()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return fmt.Errorf("opencode not ready on port %d after %s", externalPort, deadline)
}

// errAuthProbeUnreachable marks a transport-level failure of the auth
// enforcement probe (opencode's internal listener not up yet, a connection
// reset). It is retryable — waitForReadiness keeps polling. A definite non-401
// *status* is NOT this error: that's a real security failure and fails closed.
var errAuthProbeUnreachable = errors.New("opencode-auth-probe-unreachable")

// requireOpenCodeAuthEnforced is the Fix A′ fail-closed guard: an
// unauthenticated request to a real opencode CONTROL endpoint must be rejected
// with 401. We probe `POST /session` — the create-session call a sibling would
// use to hijack a worker — rather than just `GET /`. The production risk this
// PR closes is direct sibling access to the control API (POST /session,
// /session/{id}/prompt_async, /event), so proving the root route is protected
// isn't enough: if opencode ever moved to per-route auth where `/` stays 401
// while `/session` is reachable, a bare `GET /` probe would be fooled and the
// worker would start with its control plane exposed. Anything other than 401
// here means OPENCODE_SERVER_PASSWORD isn't gating the control API; the caller
// must not let the worker serve traffic in that state.
//
// Return contract:
//   - nil                                   — 401: auth is enforced.
//   - error wrapping errAuthProbeUnreachable — transport failure: retryable.
//   - other error                           — a definite non-401 response: fail closed.
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
		return fmt.Errorf("opencode did not require auth on internal port %d (POST /session got %d, want 401) — refusing to start worker unsecured", internalPort, resp.StatusCode)
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

// postMessage queues a turn for the worker. 204/2xx → success. 404 means
// the session vanished (rare; surfaces as errSessionNotFound so handler.go
// can recycle the worker).
func postMessage(ctx context.Context, port int, bearerToken, sessionID, system, userText string) error {
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
	url := fmt.Sprintf("http://127.0.0.1:%d/session/%s/prompt_async", port, sessionID)
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
		return errSessionNotFound
	}
	if resp.StatusCode >= 400 && resp.StatusCode != http.StatusNoContent {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("post message: %d %s", resp.StatusCode, string(b))
	}
	return nil
}

// streamSessionEvents tails /event from the worker and forwards every event
// belonging to sessionID as one ndjson line to w. Returns when a terminal
// event lands or the context is cancelled. The fetch carries the same ctx
// so a client disconnect aborts the upstream socket immediately — opencode
// would otherwise hold it open until it had something to send.
func streamSessionEvents(ctx context.Context, port int, bearerToken, sessionID string, w io.Writer, flush func()) error {
	url := fmt.Sprintf("http://127.0.0.1:%d/event", port)
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
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(line[len("data:"):])
		if payload == "" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}
		if !eventBelongsToSession(event, sessionID) {
			continue
		}
		if _, err := w.Write(append([]byte(payload), '\n')); err != nil {
			return nil // client disconnect — opencode keeps producing, but we're done.
		}
		if flush != nil {
			flush()
		}
		if typ, _ := event["type"].(string); typ != "" {
			if _, ok := terminalEventTypes[typ]; ok {
				return nil
			}
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

// eventBelongsToSession extracts the session id from any of the shapes
// OpenCode has emitted across versions. If none match the routed session,
// the event belongs to a different worker's session and we skip it.
func eventBelongsToSession(event map[string]any, sessionID string) bool {
	if sessionID == "" {
		return false
	}
	if v, _ := event["sessionID"].(string); v != "" {
		return v == sessionID
	}
	if v, _ := event["sessionId"].(string); v != "" {
		return v == sessionID
	}
	if v, _ := event["session_id"].(string); v != "" {
		return v == sessionID
	}
	props, _ := event["properties"].(map[string]any)
	if props != nil {
		if v, _ := props["sessionID"].(string); v != "" {
			return v == sessionID
		}
		if v, _ := props["sessionId"].(string); v != "" {
			return v == sessionID
		}
	}
	return false
}
