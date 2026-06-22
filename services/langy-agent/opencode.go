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
func waitForReadiness(ctx context.Context, port int, deadline time.Duration) error {
	dl := time.Now().Add(deadline)
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	for time.Now().Before(dl) {
		reqCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
		resp, err := httpClient.Do(req)
		cancel()
		if err == nil {
			_ = resp.Body.Close()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return fmt.Errorf("opencode not ready on port %d after %s", port, deadline)
}

// createOpenCodeSession posts a fresh session to the worker. Returns the
// session id we route subsequent prompts to.
func createOpenCodeSession(ctx context.Context, port int) (string, error) {
	body := bytes.NewBufferString(`{"title":"langy"}`)
	url := fmt.Sprintf("http://127.0.0.1:%d/session", port)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
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
func postMessage(ctx context.Context, port int, sessionID, system, userText string) error {
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
func streamSessionEvents(ctx context.Context, port int, sessionID string, w io.Writer, flush func()) error {
	url := fmt.Sprintf("http://127.0.0.1:%d/event", port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
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
