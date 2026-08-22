package opencode

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
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
	"github.com/langwatch/langwatch/services/langyagent/internal/toolmap"
)

// terminalEventTypes are the SSE event types that close the per-turn stream:
// once we see one of these, the worker is done producing this turn's output and
// we stop forwarding to the client.
var terminalEventTypes = map[string]struct{}{
	"message.completed": {},
	"message.done":      {},
	"session.idle":      {},
	"session.completed": {},
	// All three error spellings opencode has used: a session that dies on its
	// first LLM call emits `session.error` / `message.error`, and missing them
	// here leaves the stream waiting in silence until the liveness sweep
	// misreads a deterministic failure as a 90s stall (retried ×3).
	"error":         {},
	"session.error": {},
	"message.error": {},
	// ADR-048: opencode emits a terminal `handoff` frame carrying an opaque
	// resume token when it checkpoints on a shutdown-imminent notice. Treating
	// it as terminal lets the in-flight turn's StreamEvents forward the frame to
	// the sink (and thence to the control plane over the open /chat response)
	// and return cleanly, exactly like any other terminal event.
	"handoff": {},
}

// errAuthProbeUnreachable marks a transport-level failure of the auth
// enforcement probe (opencode's internal listener not up yet, a connection
// reset). It is retryable — WaitForReadiness keeps polling. A definite non-401
// *status* is NOT this error: that's a real security failure and fails closed.
// Kept as an internal sentinel (not a herr code): it never leaves the pool, it
// only classifies a retry inside WaitForReadiness.
var errAuthProbeUnreachable = errors.New("opencode-auth-probe-unreachable")

// httpClient is reused across all opencode calls. opencode binds 127.0.0.1 per
// worker; we only ever talk to localhost. A long stream timeout would truncate
// generations, so the read deadline is per-request.
//
// Deliberately NOT wrapped in otelhttp: the /event SSE poll and per-message
// POSTs would parent a client span per call into the turn's trace — dense,
// low-value spans at exactly the trace's hottest point. Worker activity
// reaches the trace through the OTel relay's reparenting instead, and
// opencode ignores inbound traceparent anyway.
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
		// Stream B (ADR-077): a message.part.delta carries the token text in
		// properties.delta when properties.field=="text". Decoded here so the raw
		// token fast-path reads the same single sseEvent decode as session routing.
		Field string `json:"field"`
		Delta string `json:"delta"`
		// PartID names the message part a delta belongs to. Load-bearing for
		// reasoning routing: codex reasoning-summary parts stream their text
		// with field=="text" (same channel as answer tokens), so the part's
		// TYPE — learned from message.part.updated — is the only thing that
		// tells thinking apart from the answer.
		PartID string `json:"partID"`
		// Part is where opencode puts the message part on `message.part.updated` —
		// the carrier for the tool-call lifecycle (see ssePart).
		Part ssePart `json:"part"`
	} `json:"properties"`
	// Part carries the legacy type=="text" token shape (part.text), and the
	// unwrapped part shape some opencode versions emit at the top level.
	Part ssePart `json:"part"`
}

// ssePart is an opencode message part. Text parts carry `text`; TOOL parts
// (`type":"tool"`) carry the call's identity (`tool` = name, `callID` = the
// stable id that pairs a start with its end) plus a `state` that transitions
// pending -> running -> completed | error. Decoded typed (not map[string]any) so
// the tool branch rides the SAME single decode as session routing and the text
// fast-path — no per-event boxed-any allocation on the streaming hot path.
type ssePart struct {
	ID     string       `json:"id"`
	Type   string       `json:"type"`
	Tool   string       `json:"tool"`
	CallID string       `json:"callID"`
	Text   string       `json:"text"`
	State  sseToolState `json:"state"`
}

// sseToolState is a tool part's state. `input` / `output` / `error` are held as
// raw JSON because opencode types them loosely: input is an arbitrary args
// object, and a result may arrive as a JSON string OR as a structured value.
// Keeping them raw defers the decision to toolTextFromRaw, which renders either
// shape as the STRING the frame contract requires.
type sseToolState struct {
	Status string          `json:"status"`
	Title  string          `json:"title"`
	Input  json.RawMessage `json:"input"`
	Output json.RawMessage `json:"output"`
	Error  json.RawMessage `json:"error"`
}

// addBearer attaches the per-worker bearer token to an outgoing request. Every
// helper in this file routes through the authProxy on port and so must carry
// the token; an empty token here would surface as a 401 from the authproxy,
// which is the correct fail-closed shape — better an early 401 than a silent
// missing header.
func addBearer(req *http.Request, bearerToken string) {
	req.Header.Set("Authorization", "Bearer "+bearerToken)
}

// GetFreePort asks the kernel for an ephemeral port and returns it after
// closing the listener. There is a brief race window between Close() and
// opencode binding the port, but it is short enough in practice (and opencode's
// listen() retries the SO_REUSEADDR socket).
func GetFreePort() (int, error) {
	// The bind/close pair completes in microseconds; there is no cancellation
	// to thread, so Background keeps noctx satisfied without changing callers.
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	return port, nil
}

// WaitForReadiness polls the worker until its opencode is both listening AND
// enforcing auth. It runs two probes CONCURRENTLY each cycle — both must pass:
//
//   - The external probe (probeExternalReady) hits the authProxy root. opencode
//     answers 404 on /, which is fine — any HTTP status means the server is
//     listening. Connection refused / transport error is the "not yet" state we
//     poll through. One exception: 502 from the proxy is authproxy.go's own
//     rev.ErrorHandler reporting that opencode's listener isn't up yet.
//     StartAuthProxy binds and serves synchronously, but opencode is a separate
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
func WaitForReadiness(ctx context.Context, externalPort, internalPort int, bearerToken string, deadline time.Duration) error {
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
		return fmt.Errorf("%w: %w", errAuthProbeUnreachable, err)
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

// SessionInfo is the slice of opencode's session document the resume decision
// reads: identity and recency, nothing else.
type SessionInfo struct {
	ID   string `json:"id"`
	Time struct {
		Updated int64 `json:"updated"`
	} `json:"time"`
}

// ListSessions reads the sessions opencode already holds for this home
// (GET /session). The worker home outlives the process on an idle reap or a
// crash, and opencode persists its sessions inside it — so a respawn can
// resume the newest one instead of starting over.
func ListSessions(ctx context.Context, port int, bearerToken string) ([]SessionInfo, error) {
	url := fmt.Sprintf("http://127.0.0.1:%d/session", port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	addBearer(req, bearerToken)
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list sessions: %d %s", resp.StatusCode, string(b))
	}
	var sessions []SessionInfo
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		return nil, fmt.Errorf("list sessions: decode: %w", err)
	}
	return sessions, nil
}

// NewestSession picks the most recently updated session, or "" when there is
// none worth resuming.
func NewestSession(sessions []SessionInfo) string {
	newest := ""
	var newestAt int64 = -1
	for _, s := range sessions {
		if s.ID == "" {
			continue
		}
		if s.Time.Updated > newestAt {
			newest = s.ID
			newestAt = s.Time.Updated
		}
	}
	return newest
}

// CreateSession posts a fresh session to the worker. Returns the
// session id we route subsequent prompts to.
func CreateSession(ctx context.Context, port int, bearerToken string) (string, error) {
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

// PostMessage queues a turn for the worker. 204/2xx → success. 404 means the
// session vanished (rare; surfaces as domain.ErrSessionNotFound so the
// orchestrator can recycle the worker). baseURL is the worker's precomputed
// "http://127.0.0.1:<port>" so no per-turn Sprintf is needed. resumeToken
// (ADR-048) rides the payload when resuming a prior turn's checkpoint.
func PostMessage(ctx context.Context, baseURL, bearerToken, sessionID, system, userText, resumeToken string) error {
	type part struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	payload := struct {
		Parts  []part `json:"parts"`
		System string `json:"system,omitempty"`
		// ResumeToken (ADR-048) is the opaque, worker-authored checkpoint from a
		// prior turn that handed off on shutdown. Present only when the control
		// plane found a pending handoff for this conversation; opencode restores
		// "done so far" from it instead of cold-starting. Opaque to the manager —
		// forwarded verbatim, never parsed. omitempty ⇒ a normal cold start.
		ResumeToken string `json:"resumeToken,omitempty"`
	}{
		Parts:       []part{{Type: "text", Text: userText}},
		System:      system,
		ResumeToken: resumeToken,
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

// NotifyShutdownImminent POSTs a shutdown-imminent notice to the worker's
// opencode control API (ADR-048), telling it to checkpoint the in-flight turn
// and emit a terminal `handoff` frame before the manager kills its process
// group. `deadline` is the absolute wall-clock instant (unix millis) the worker
// must checkpoint before — strictly inside the graceful window (see the ADR-048
// deadline math). Best-effort: a non-2xx or transport error is returned to the
// caller, which logs and proceeds with the drain (a worker that cannot be
// notified simply cold-starts on its next turn, today's behavior). opencode is
// expected to answer 2xx/204; a 404 means the session already vanished.
func NotifyShutdownImminent(ctx context.Context, baseURL, bearerToken, sessionID string, deadline time.Time) error {
	body := bytes.NewBufferString(fmt.Sprintf(`{"deadline":%d}`, deadline.UnixMilli()))
	url := baseURL + "/session/" + sessionID + "/shutdown_imminent"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
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
	if resp.StatusCode >= 400 && resp.StatusCode != http.StatusNoContent {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("shutdown_imminent: %d %s", resp.StatusCode, string(b))
	}
	return nil
}

// ExtractHandoffToken pulls the opaque resume token out of a decoded `handoff`
// ndjson frame (ADR-048). The token is opaque to the manager — this exists only
// so tests (and any future manager-side bookkeeping) can assert the frame shape;
// the token itself is never interpreted here, only on the control plane (which
// persists it) and in opencode (which authors and consumes it). Tolerates the
// bare `token` field and a nested `properties.token`, mirroring the
// session-id shape-tolerance in eventBelongsToSession.
func ExtractHandoffToken(event map[string]any) (string, bool) {
	if typ, _ := event["type"].(string); typ != "handoff" {
		return "", false
	}
	if v, _ := event["token"].(string); v != "" {
		return v, true
	}
	if props, _ := event["properties"].(map[string]any); props != nil {
		if v, _ := props["token"].(string); v != "" {
			return v, true
		}
	}
	return "", true
}

// The manager maps each opencode event onto a typed internal/frames value —
// frames.Delta for a token, frames.ToolStart/ToolEnd for the tool lifecycle,
// frames.Heartbeat for the keep-alive — which app.Chat SIGNS and pushes to the
// control-plane relay. There is ONE frame vocabulary now (the frames union); the
// old hand-rolled langy.token/langy.tool/langy.progress structs are gone.

// progressInterval is how often the heartbeat frame is emitted. Comfortably
// below the control plane's HEARTBEAT_GRACE (30s) so a live-but-quiet turn is
// never mistaken for a dead one; matches the relay's heartbeat refresh cadence.
const progressInterval = 5 * time.Second

// textDeltaFromEvent extracts the raw token text from an already-decoded
// opencode event, or reports ok=false when the event is not a text delta. It
// decides which opencode shapes count as "a token" (fed to frames.Delta): the
// current
// `message.part.delta` (properties.field=="text", properties.delta) and the
// legacy `type=="text"` (part.text). Reads the typed sseEvent so Stream B rides
// the SAME single decode as session routing — no per-event map alloc (ADR-077
// perf). Pure — no I/O — so it is trivially unit-testable.
func textDeltaFromEvent(ev *sseEvent) (string, bool) {
	switch ev.Type {
	case "text":
		if ev.Part.Text != "" {
			return ev.Part.Text, true
		}
	case "message.part.delta":
		if ev.Properties.Field == "text" && ev.Properties.Delta != "" {
			return ev.Properties.Delta, true
		}
	}
	return "", false
}

// reasoningDeltaFromEvent extracts a run of the model's REASONING (thinking)
// tokens from an already-decoded event, or ok=false when the event is not a
// reasoning delta. opencode streams reasoning the same way it streams text — a
// `message.part.delta` — but with properties.field=="reasoning" rather than
// "text" (see textDeltaFromEvent, which deliberately rejects the reasoning
// field). Ephemeral: it rides the live edge as a frames.Reasoning and never the
// durable final. Pure — trivially unit-testable.
func reasoningDeltaFromEvent(ev *sseEvent) (string, bool) {
	if ev.Type == "message.part.delta" &&
		ev.Properties.Field == "reasoning" && ev.Properties.Delta != "" {
		return ev.Properties.Delta, true
	}
	return "", false
}

// reasoningPartType is opencode's part.type for the model's thinking. Its
// deltas may arrive on field=="text" (the codex path streams reasoning-summary
// text on the same field as answer tokens), so the part type — not the delta
// field — is the authority on what a delta IS.
const reasoningPartType = "reasoning"

// deltaPartID is the message-part id a delta event belongs to: the current
// shape carries it as properties.partID; the legacy type=="text" shape names
// its part on part.id. Empty when the event names no part.
func deltaPartID(ev *sseEvent) string {
	if ev.Properties.PartID != "" {
		return ev.Properties.PartID
	}
	return ev.Part.ID
}

// recordPartType notes a part's declared type from a message.part.updated (or
// unwrapped part) event, so later deltas route by what the part IS.
func recordPartType(partTypes map[string]string, ev *sseEvent) {
	if id := ev.Properties.Part.ID; id != "" && ev.Properties.Part.Type != "" {
		partTypes[id] = ev.Properties.Part.Type
	}
	if id := ev.Part.ID; id != "" && ev.Part.Type != "" {
		partTypes[id] = ev.Part.Type
	}
}

// The tool lifecycle is emitted as frames.ToolStart / frames.ToolEnd (the frames
// union `tool` frame), so the control plane can event-source the call
// (tool_call_initiated / tool_call_succeeded / tool_call_failed) and stream a
// mapped UI card without re-deriving the lifecycle from raw opencode parts.

// opencode's `part.type` for a tool call, and the `state.status` values a tool
// part transitions through. `completed` and `error` are the settle transitions.
// `failed` is not a shape opencode is known to emit — it is tolerated as an
// error alias purely so an unrecognized settle status can never strand a card
// spinning forever with no `end`.
const (
	toolPartType        = "tool"
	toolStatusRunning   = "running"
	toolStatusCompleted = "completed"
	toolStatusError     = "error"
	toolStatusFailed    = "failed"
)

// toolStateSettled classifies a tool state.status: reports whether the call has
// finished, and whether it finished badly.
func toolStateSettled(status string) (settled, isError bool) {
	switch status {
	case toolStatusCompleted:
		return true, false
	case toolStatusError, toolStatusFailed:
		return true, true
	}
	return false, false
}

// toolPartFromEvent returns the tool part an opencode event carries, if any.
// opencode wraps the part under `properties.part` on `message.part.updated`;
// some versions emit it unwrapped at the top level. Both are accepted — the
// event `type` is deliberately NOT gated on, so a tool part is picked up
// whichever envelope delivers it.
func toolPartFromEvent(ev *sseEvent) (*ssePart, bool) {
	if ev.Properties.Part.Type == toolPartType {
		return &ev.Properties.Part, true
	}
	if ev.Part.Type == toolPartType {
		return &ev.Part, true
	}
	return nil, false
}

// toolCallID is the stable id that pairs a start frame with its end. opencode's
// `callID` is the tool call's own identity; the part `id` is the fallback for a
// shape that omits it. Whichever is used, the SAME part yields the same id on
// every re-send, which is what makes the de-dupe and the pairing work.
func toolCallID(part *ssePart) string {
	if part.CallID != "" {
		return part.CallID
	}
	return part.ID
}

// toolStateOpensCard reports whether a not-yet-settled tool state exposes enough
// to open a card — and the bar is the INPUT, not the status.
//
// It used to open on `running` alone, on the belief that `running` is the
// "args known, tool executing" transition and therefore always carries them.
// Production disagrees: opencode emits `running` with an input of `{}` and fills
// the arguments in on a later re-send of that same `running`. Opening on the
// status meant opening before the args existed, and the tracker then treated the
// re-send that carried them as a duplicate to drop.
//
// So the card opens the moment we can say what the call is DOING, whichever
// transition brings that — a `pending` that already carries input opens it, a
// `running` that does not yet carry input waits. Nothing is stranded by waiting:
// a tool that never surfaces an input at all still gets its start emitted from
// the settle transition (see framesFor), which is the last shape that could
// possibly carry one.
func toolStateOpensCard(part *ssePart) bool {
	return toolmap.HasToolInput(part.State.Input)
}

// toolStartFrame opens the card: the tool's identity plus, when opencode has
// surfaced them, the human title and the args it was called with. Marshals to the
// frames union `tool` start frame; a marshal failure (never realistically) drops
// the frame, best-effort like the rest of the lifecycle.
func toolStartFrame(id string, part *ssePart) (frames.Frame, bool) {
	f, err := frames.ToolStart(id, part.Tool, part.State.Title, "", toolmap.RawToolValue(part.State.Input))
	return f, err == nil
}

// toolEndFrame closes the card with the settled result. On an error settle the
// error message IS the output (that is what the card shows); it falls back to
// the output field when opencode reported the failure there instead.
//
// The end frame carries the INPUT as well as the output. That is not redundant
// with the start frame: it makes each event self-describing, so "what command
// was this, and how did it end?" is answerable from the end event alone — by the
// card, by the durable event log, and by anyone debugging a turn after the fact.
// It also means a call whose start went out before its arguments materialized is
// still correctly identified when it settles, rather than being permanently
// anonymous because of the transition it happened to open on.
func toolEndFrame(id string, part *ssePart, isError bool) (frames.Frame, bool) {
	output := toolmap.ToolTextFromRaw(part.State.Output)
	if isError {
		// The error message is what the card shows for a failed call — UNLESS
		// the command already said, precisely, what went wrong.
		//
		// A LangWatch CLI command that fails under a machine format writes its
		// failure DOCUMENT to stdout — the code, the offending field or
		// permission, the platform's own next steps — and a one-line human
		// summary to stderr. Overwriting stdout with that summary threw all of
		// it away at the first hop, and the panel, which reads the document
		// structurally, was left with a sentence it could not act on. It then
		// showed the user "This step couldn't be completed" for a failure the
		// platform had explained in full.
		if msg := toolmap.ToolTextFromRaw(part.State.Error); msg != "" && !toolmap.CarriesFailureDocument(output) {
			output = msg
		}
	}
	output = toolmap.TruncateToolOutput(output)
	// durationMs is not surfaced by opencode's part stream; the durable milestone
	// carries none (0 ⇒ omitted). isError routes succeeded vs failed on the relay.
	// The input rides the end too, so the settle event is self-describing.
	f, err := frames.ToolEnd(id, part.Tool, toolmap.RawToolValue(part.State.Input), isError, output, 0)
	return f, err == nil
}

// toolCallTracker binds the shared per-turn de-dupe tracker (internal/toolmap)
// to opencode's part shapes: the tracker guarantees exactly one `start` and one
// `end` frame per callID across opencode's re-sent part updates; framesFor
// keeps the part-decoding half here. Scoped to a single StreamSession call,
// one turn, one tracker, no cross-turn leak.
type toolCallTracker struct {
	*toolmap.ToolCallTracker
}

func newToolCallTracker() *toolCallTracker {
	return &toolCallTracker{toolmap.NewToolCallTracker()}
}

func newToolCallTrackerWithClock(now func() time.Time) *toolCallTracker {
	return &toolCallTracker{toolmap.NewToolCallTrackerWithClock(now)}
}

// framesFor maps one decoded opencode event onto the frames-union tool frames it
// should produce: nothing for a non-tool event, a `start` the first time the call
// exposes its name + input, and an `end` on the settle transition. A tool whose
// only surfaced transition is the settle one (a fast tool that never showed a
// `running`) still gets its `start` emitted first, so the consumer is never
// asked to close a card it was never told to open. Pure apart from the tracker's
// own bookkeeping — no I/O — so it is trivially unit-testable, mirroring
// textDeltaFromEvent.
func (t *toolCallTracker) framesFor(ev *sseEvent) []frames.Frame {
	part, ok := toolPartFromEvent(ev)
	if !ok {
		return nil
	}
	id := toolCallID(part)
	if id == "" || part.Tool == "" {
		return nil
	}
	settled, isError := toolStateSettled(part.State.Status)
	if !settled && !toolStateOpensCard(part) {
		return nil
	}

	var out []frames.Frame
	if t.StartIfNew(id) {
		if f, ok := toolStartFrame(id, part); ok {
			out = append(out, f)
		}
	}
	if !settled {
		return out
	}
	if t.EndIfNew(id, part.Tool) {
		if f, ok := toolEndFrame(id, part, isError); ok {
			out = append(out, f)
		}
		// A settled `todowrite` also mirrors as a typed plan snapshot — emitted
		// alongside the tool frame above (which stays for the durable audit
		// trail). Manager as sole frame author; the panel renders the checklist.
		if toolmap.IsTodoWriteTool(part.Tool) {
			if items, ok := toolmap.PlanItemsFromInput(part.State.Input); ok {
				if f, err := frames.Plan(items); err == nil {
					out = append(out, f)
				}
				if f, ok := t.MeasuredProgressFromPlan(items); ok {
					out = append(out, f)
				}
			}
		}
	}
	return out
}

// StreamSession tails /event from the worker and maps every event belonging to
// sessionID onto typed internal/frames values, handing each to emit. Returns when
// a terminal event lands or the context is canceled, nil on a clean completion,
// domain.ErrTurnHandedOff on an ADR-048 handoff, an error for an opencode `error`
// event or a transport failure. The fetch carries the same ctx so a cancel aborts
// the upstream socket immediately — opencode would otherwise hold it open until it
// had something to send. baseURL is the worker's "http://127.0.0.1:<port>".
//
// It reads with scanner.Bytes() (no per-line string alloc) and routes via the
// typed sseEvent. The manager is the SOLE author of the frames the control plane
// sees: a text delta becomes frames.Delta, the tool lifecycle frames.ToolStart/
// ToolEnd, the keep-alive frames.Heartbeat. The verbatim opencode line is NOT
// forwarded — the relay speaks only the frames union; app.Chat assembles the
// durable final from the emitted frames. emit is serialized by a single mutex so
// the concurrent heartbeat ticker never interleaves with the scan loop.
func StreamSession(ctx context.Context, baseURL, bearerToken, sessionID string, emit func(frames.Frame) error) error {
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

	// All emits go through emitFrame so the concurrent heartbeat ticker can never
	// interleave with the scan loop: the relay push is ONE ordered stream, so a
	// single mutex serializes frame writes exactly like the old in-band writeMu (and
	// keeps the durable-final accumulator, fed inside emit, free of a data race).
	// Returns false on an emit error (the relay push broke) so callers stop.
	var emitMu sync.Mutex
	emitFrame := func(f frames.Frame) bool {
		emitMu.Lock()
		defer emitMu.Unlock()
		return emit(f) == nil
	}

	// Heartbeat: emit a frames.Heartbeat every progressInterval so the relay keeps
	// the turn's liveness fresh (freshness = alive) through a long, silent tool call
	// — the scan loop blocks on upstream bytes and cannot self-tick through silence.
	// Best-effort; an emit error just stops the ticker (the loop detects the same
	// break). We wait for the goroutine to exit before returning so no heartbeat
	// races teardown. Panic-guarded (review H2): a marshal panic in this hot loop
	// must never take down the single-replica manager.
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer clog.HandlePanic(ctx, false)
		ticker := time.NewTicker(progressInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				hb, mErr := frames.Heartbeat()
				if mErr != nil {
					continue
				}
				if !emitFrame(hb) {
					return
				}
			}
		}
	}()
	defer func() {
		close(stop)
		wg.Wait()
	}()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	dataPrefix := []byte("data:")
	var ev sseEvent
	tools := newToolCallTracker() // per-turn de-dupe of the tool start/end frames
	// Part id -> declared part type, learned from message.part.updated. Routing
	// authority for deltas: a reasoning part's deltas stream on field=="text"
	// on the codex path, and only this map keeps that thinking out of the
	// durable answer text.
	partTypes := make(map[string]string)
	// Segment tracking for the paragraph restore below: text deltas carry no
	// message-part boundary, so "a tool settled since the last token" is how we
	// know the next token starts a NEW segment of the answer.
	emittedText := false
	toolSinceText := false
	// The two routes a delta can take. Answer text rides frames.Delta into the
	// live edge AND the durable final; reasoning rides frames.Reasoning,
	// ephemeral, never the final. Both report false when the relay push broke.
	emitAnswerDelta := func(delta string) bool {
		// Text resuming AFTER a tool call is a new message segment, but the
		// deltas carry no boundary: everything downstream (the live text
		// stream and the durable final alike) concatenates them into one
		// string, gluing the pre-tool preamble straight onto the post-tool
		// answer ("...for those traces.No traces failing..."). Restore the
		// paragraph the model actually produced.
		if emittedText && toolSinceText {
			delta = "\n\n" + delta
		}
		emittedText = true
		toolSinceText = false
		f, mErr := frames.Delta(delta)
		if mErr != nil {
			return true
		}
		return emitFrame(f)
	}
	emitReasoningDelta := func(delta string) bool {
		f, mErr := frames.Reasoning(delta)
		if mErr != nil {
			return true
		}
		return emitFrame(f)
	}
	// Deltas for parts whose type is not yet declared, in arrival order. The
	// stream carries NO ordering guarantee between a part's first
	// message.part.delta and the message.part.updated that declares its type,
	// and field=="text" alone cannot tell answer text from codex
	// reasoning-summary text, so an undeclared part's deltas wait here and
	// replay through the real routing the moment the declaration lands.
	// Buffered deltas are replayed exactly once (drained entries are removed)
	// and per-part arrival order is preserved.
	var pendingOrder []string
	pendingDeltas := map[string][]string{}
	routeDelta := func(id, delta string) bool {
		if partTypes[id] == reasoningPartType {
			return emitReasoningDelta(delta)
		}
		return emitAnswerDelta(delta)
	}
	// drainPending replays buffered deltas whose part type is now known. With
	// force set (the stream is settling) it replays everything: a part still
	// undeclared at settle routes as answer text, because with no declaration
	// there is no evidence it was thinking and answer text must never be
	// silently dropped from the final. Reports false when the relay push broke.
	drainPending := func(force bool) bool {
		kept := pendingOrder[:0]
		for _, id := range pendingOrder {
			if !force && partTypes[id] == "" {
				kept = append(kept, id)
				continue
			}
			for _, delta := range pendingDeltas[id] {
				if !routeDelta(id, delta) {
					return false
				}
			}
			delete(pendingDeltas, id)
		}
		pendingOrder = kept
		return true
	}
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
			// Error events without a session id still terminate this turn: the
			// worker serves one conversation, so an unrouted error can only be ours.
			if !isErrorEventType(ev.Type) || eventCarriesSession(&ev) {
				continue
			}
		}
		// Part-type bookkeeping first, then replay: deltas that arrived before
		// their part's declaration now route by what the part IS.
		recordPartType(partTypes, &ev)
		if !drainPending(false) {
			return nil // relay push broke.
		}
		// Token fast-path: emit the delta frame so time-to-first-token is not gated
		// behind the tool frames below.
		if delta, ok := textDeltaFromEvent(&ev); ok {
			id := deltaPartID(&ev)
			switch {
			case partTypes[id] == reasoningPartType:
				// A reasoning part streaming on field=="text" (codex
				// reasoning-summary titles) is THINKING, not the answer:
				// route it as an ephemeral reasoning frame so it never
				// reaches the durable final text.
				if !emitReasoningDelta(delta) {
					return nil // relay push broke.
				}
			case id != "" && partTypes[id] == "":
				// The part this delta belongs to is not declared yet: hold it
				// until message.part.updated names what the part IS, so early
				// reasoning can never leak into the durable answer.
				if _, buffered := pendingDeltas[id]; !buffered {
					pendingOrder = append(pendingOrder, id)
				}
				pendingDeltas[id] = append(pendingDeltas[id], delta)
			default:
				if !emitAnswerDelta(delta) {
					return nil // relay push broke.
				}
			}
		}
		// Reasoning fast-path: the model's thinking rides the same live edge as a
		// token, ephemerally (never durable). Shown while it streams, discarded on
		// settle.
		if reasoning, ok := reasoningDeltaFromEvent(&ev); ok {
			if !emitReasoningDelta(reasoning) {
				return nil // relay push broke.
			}
		}
		// Tool lifecycle: start/end frames as the call opens and settles.
		for _, tf := range tools.framesFor(&ev) {
			if !emitFrame(tf) {
				return nil
			}
			toolSinceText = true
		}
		// Terminal handling. The verbatim opencode event is NOT forwarded any more
		// (the relay speaks only the frames union); the durable final is assembled by
		// app.Chat from the emitted frames. Three terminal outcomes are distinguished:
		//   - handoff (ADR-048): map the opaque resume token onto a terminal
		//     frames.Handoff the relay persists, then signal ErrTurnHandedOff so the
		//     app skips its own terminal frame but still posts the durable final;
		//   - error: return the agent's message so the app emits a frames.Error;
		//   - anything else: normal completion (nil ⇒ app emits frames.Final).
		if _, terminal := terminalEventTypes[ev.Type]; terminal {
			// Flush buffered deltas ahead of the terminal so they precede the
			// terminal frame and reach the durable fold; best-effort, the
			// terminal outcome below stands regardless.
			_ = drainPending(true)
			switch ev.Type {
			case "handoff":
				var m map[string]any
				_ = json.Unmarshal(payload, &m)
				token, _ := ExtractHandoffToken(m)
				if f, mErr := frames.Handoff(token); mErr == nil {
					_ = emitFrame(f)
				}
				return domain.ErrTurnHandedOff
			case "error", "session.error", "message.error":
				// agent_error is the KNOWN state; the raw opencode prose is unknown
				// content and rides as a wrapped plain-error reason — visible in the
				// manager's log, collapsed to "unknown" by herr.Body if it ever hit a
				// wire. app.Chat composes the vetted wire herr.
				return herr.NewLight(ctx, domain.ErrAgentError, nil,
					errors.New(agentErrorMessage(payload)))
			default:
				return nil
			}
		}
	}
	// The stream ended without a terminal event (the worker cut it): flush any
	// still-buffered deltas so their text is not silently dropped.
	_ = drainPending(true)
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return err
	}
	return nil
}

// agentErrorMessage best-effort extracts a human message from an opencode `error`
// event, tolerating the bare `error`/`message` field and a nested `properties.*`,
// mirroring the shape-tolerance in eventBelongsToSession / ExtractHandoffToken.
func agentErrorMessage(payload []byte) string {
	var m map[string]any
	if json.Unmarshal(payload, &m) == nil {
		if s, _ := m["error"].(string); s != "" {
			return s
		}
		if s, _ := m["message"].(string); s != "" {
			return s
		}
		if props, _ := m["properties"].(map[string]any); props != nil {
			if s, _ := props["error"].(string); s != "" {
				return s
			}
			if s, _ := props["message"].(string); s != "" {
				return s
			}
		}
	}
	return "the agent hit an error"
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

// isErrorEventType reports whether the event is one of opencode's error
// spellings. Kept separate from terminalEventTypes membership because error
// events get one extra tolerance: passing the session gate when they carry no
// session id at all (see the routing loop).
func isErrorEventType(t string) bool {
	return t == "error" || t == "session.error" || t == "message.error"
}

// eventCarriesSession reports whether the event names ANY session. An error
// event with no session id cannot be routed by id, but this process serves a
// single conversation, so it can only mean this worker's session — dropping it
// leaves the turn waiting in silence until the liveness sweep fails it.
func eventCarriesSession(ev *sseEvent) bool {
	return ev.SessionID != "" || ev.SessionId != "" || ev.SessionUnderscore != "" ||
		ev.Properties.SessionID != "" || ev.Properties.SessionId != ""
}
