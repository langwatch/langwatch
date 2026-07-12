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
	"unicode/utf8"

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
		// Stream B (ADR-048): a message.part.delta carries the token text in
		// properties.delta when properties.field=="text". Decoded here so the raw
		// token fast-path reads the same single sseEvent decode as session routing.
		Field string `json:"field"`
		Delta string `json:"delta"`
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
	l, err := net.Listen("tcp", "127.0.0.1:0")
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
// notified simply cold-starts on its next turn, today's behaviour). opencode is
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

// langyTokenFrame is the compact Stream B fast-path frame (ADR-048). It rides
// the SAME /chat ndjson stream as the full events (Stream A), multiplexed by
// `type`. The control plane's runTurn peels these off to the ephemeral fast
// pub/sub channel and ignores them on the durable path (parseAgentLine only
// matches text/message.part.delta/error, so an unknown `type` is dropped there).
type langyTokenFrame struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// langyTokenType is the discriminator the control plane matches on to route a
// frame to Stream B. Kept as a single source of truth for the wire contract.
const langyTokenType = "langy.token"

// langyProgressFrame is a periodic "still working" heartbeat, multiplexed on the
// same /chat ndjson stream. It carries no content: its only job is to keep the
// stream producing during a long, silent tool call so the control-plane relay
// keeps refreshing the turn's liveness key (the scan loop below blocks on
// upstream bytes, so it cannot self-tick through silence). The relay treats it
// as ephemeral — it refreshes liveness and drops it, never event-sourcing it.
type langyProgressFrame struct {
	Type string `json:"type"`
}

// langyProgressType is the discriminator for the heartbeat frame.
const langyProgressType = "langy.progress"

// progressInterval is how often the heartbeat frame is emitted. Comfortably
// below the control plane's HEARTBEAT_GRACE (30s) so a live-but-quiet turn is
// never mistaken for a dead one; matches the relay's heartbeat refresh cadence.
const progressInterval = 5 * time.Second

// textDeltaFromEvent extracts the raw token text from an already-decoded
// opencode event, or reports ok=false when the event is not a text delta. It
// mirrors the control plane's parseAgentLine (langy-turn.processor.ts) exactly
// so both ends agree on which opencode shapes are "a token": the current
// `message.part.delta` (properties.field=="text", properties.delta) and the
// legacy `type=="text"` (part.text). Reads the typed sseEvent so Stream B rides
// the SAME single decode as session routing — no per-event map alloc (ADR-044
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

// langyToolFrame is the compact tool-lifecycle frame. Like langyTokenFrame it
// rides the SAME /chat ndjson stream as the full events, multiplexed by `type`,
// so the control plane can event-source the call (tool_call_initiated /
// tool_call_succeeded / tool_call_failed) and stream a mapped UI card without re-deriving the
// lifecycle from raw opencode parts.
//
// Optionality is carried by pointers/omitempty so the wire shape is exact:
// a `start` frame is {type,id,name,phase[,title][,input]} and an `end` frame is
// {type,id,name,phase[,input],output,isError} — `isError` is ALWAYS present on an
// end (false is meaningful there), and always absent on a start.
//
// BOTH phases carry the input, so either event identifies the call on its own.
type langyToolFrame struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Phase   string          `json:"phase"`
	Title   string          `json:"title,omitempty"`
	Input   json.RawMessage `json:"input,omitempty"`
	Output  *string         `json:"output,omitempty"`
	IsError *bool           `json:"isError,omitempty"`
}

// langyToolType is the discriminator the control plane matches on to route a
// frame to the tool-card mapper. Single source of truth for the wire contract,
// mirroring langyTokenType.
const langyToolType = "langy.tool"

const (
	toolPhaseStart = "start"
	toolPhaseEnd   = "end"
)

// opencode's `part.type` for a tool call, and the `state.status` values a tool
// part transitions through. `completed` and `error` are the settle transitions.
// `failed` is not a shape opencode is known to emit — it is tolerated as an
// error alias purely so an unrecognised settle status can never strand a card
// spinning forever with no `end`.
const (
	toolPartType        = "tool"
	toolStatusRunning   = "running"
	toolStatusCompleted = "completed"
	toolStatusError     = "error"
	toolStatusFailed    = "failed"
)

// maxToolOutputBytes caps a forwarded tool result. A tool can return megabytes
// (a big file read, a wide query); the card only ever shows a preview, so the
// stream must not carry the whole thing. Overflow is cut on a rune boundary and
// marked with a trailing ellipsis.
const maxToolOutputBytes = 8 * 1024

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

// rawToolValue normalises an optional raw JSON field: an absent field and an
// explicit `null` both become nil, so the frame omits them rather than carrying
// a meaningless `"input":null`.
func rawToolValue(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil
	}
	return raw
}

// hasToolInput reports whether a tool part actually tells us WHAT the call is
// doing — i.e. whether its input carries any argument at all.
//
// `{}` is the case that matters and the one `rawToolValue` cannot see: it is a
// present, valid, entirely uninformative object. opencode really does emit a
// `running` transition whose input is still `{}` and then RE-SEND the same
// `running` once the arguments have materialised (the re-send is a known shape —
// see the tracker's dedupe). Treating that first empty `{}` as "we know the
// input" is what stranded every card: the start frame went out with no command,
// the tracker latched the call as started, and the re-send carrying the actual
// command was dropped as a duplicate. The command then existed nowhere on the
// wire — not on the start, not on the end — so the control plane could not
// re-type `bash("langwatch trace search")` into the capability it was, and the
// panel had nothing to label the card with but the tool's own name ("Bash…").
//
// So an empty object is NOT input. Waiting one more transition for the real
// thing is the whole difference between a card that says what it is doing and a
// card that says "Bash".
func hasToolInput(raw json.RawMessage) bool {
	raw = rawToolValue(raw)
	if len(raw) == 0 {
		return false
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err == nil {
		return len(probe) > 0
	}
	// A non-object input (opencode types tool input loosely) is information.
	return true
}

// toolTextFromRaw renders a raw tool result as the STRING the frame contract
// requires. A JSON string is unquoted to its value; any other JSON value (an
// object, an array, a number — opencode types tool output loosely) is carried
// as its compact JSON text, which is exactly its marshalled form.
func toolTextFromRaw(raw json.RawMessage) string {
	raw = rawToolValue(raw)
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return string(raw)
}

// truncateToolOutput caps a result at maxToolOutputBytes so one huge tool return
// cannot bloat the stream. The cut backs up to a rune boundary so the truncated
// string stays valid UTF-8, and is marked so the UI can show it was clipped.
func truncateToolOutput(s string) string {
	if len(s) <= maxToolOutputBytes {
		return s
	}
	cut := maxToolOutputBytes
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
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
	return hasToolInput(part.State.Input)
}

// toolStartFrame opens the card: the tool's identity plus, when opencode has
// surfaced them, the human title and the args it was called with.
func toolStartFrame(id string, part *ssePart) langyToolFrame {
	return langyToolFrame{
		Type:  langyToolType,
		ID:    id,
		Name:  part.Tool,
		Phase: toolPhaseStart,
		Title: part.State.Title,
		Input: rawToolValue(part.State.Input),
	}
}

// toolEndFrame closes the card with the settled result. On an error settle the
// error message IS the output (that is what the card shows); it falls back to
// the output field when opencode reported the failure there instead.
//
// The end frame carries the INPUT as well as the output. That is not redundant
// with the start frame: it makes each event self-describing, so "what command
// was this, and how did it end?" is answerable from the end event alone — by the
// card, by the durable event log, and by anyone debugging a turn after the fact.
// It also means a call whose start went out before its arguments materialised is
// still correctly identified when it settles, rather than being permanently
// anonymous because of the transition it happened to open on.
func toolEndFrame(id string, part *ssePart, isError bool) langyToolFrame {
	output := toolTextFromRaw(part.State.Output)
	if isError {
		if msg := toolTextFromRaw(part.State.Error); msg != "" {
			output = msg
		}
	}
	output = truncateToolOutput(output)
	return langyToolFrame{
		Type:    langyToolType,
		ID:      id,
		Name:    part.Tool,
		Phase:   toolPhaseEnd,
		Input:   rawToolValue(part.State.Input),
		Output:  &output,
		IsError: &isError,
	}
}

// toolCallTracker de-dupes the tool lifecycle across the re-sent part updates
// opencode emits: a tool part is re-published on every state transition (and can
// repeat within one), so the same callID lands on the stream many times. The
// tracker holds the per-turn set of ids it has already opened and closed, which
// is what guarantees EXACTLY one `start` and one `end` per call. Scoped to a
// single StreamSession call — one turn, one tracker, no cross-turn leak.
type toolCallTracker struct {
	started map[string]struct{}
	ended   map[string]struct{}
}

func newToolCallTracker() *toolCallTracker {
	return &toolCallTracker{
		started: map[string]struct{}{},
		ended:   map[string]struct{}{},
	}
}

// framesFor maps one decoded opencode event onto the langy.tool frames it should
// produce: nothing for a non-tool event, a `start` the first time the call
// exposes its name + input, and an `end` on the settle transition. A tool whose
// only surfaced transition is the settle one (a fast tool that never showed a
// `running`) still gets its `start` emitted first, so the consumer is never
// asked to close a card it was never told to open. Pure apart from the tracker's
// own bookkeeping — no I/O — so it is trivially unit-testable, mirroring
// textDeltaFromEvent.
func (t *toolCallTracker) framesFor(ev *sseEvent) []langyToolFrame {
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

	var frames []langyToolFrame
	if _, seen := t.started[id]; !seen {
		t.started[id] = struct{}{}
		frames = append(frames, toolStartFrame(id, part))
	}
	if !settled {
		return frames
	}
	if _, seen := t.ended[id]; !seen {
		t.ended[id] = struct{}{}
		frames = append(frames, toolEndFrame(id, part, isError))
	}
	return frames
}

// StreamSession tails /event from the worker and forwards every event
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
//
// Stream B (ADR-048): when a forwarded event is a text delta, a compact
// {"type":"langy.token","text":...} frame is written and flushed FIRST — ahead
// of the heavy full-event line — so the raw-token fast-path is never queued
// behind Stream A's payload. That is the only new work per delta (one typed
// field read + one small write); terminal detection + session routing untouched.
//
// Tool lifecycle: when a forwarded event carries an opencode tool part, compact
// {"type":"langy.tool",...} start/end frames are written the same way, so the
// control plane can event-source the call and stream a mapped UI card instead of
// re-deriving the lifecycle from raw parts. Best-effort and additive — the raw
// event is still forwarded verbatim, and a tool frame never fails the turn.
func StreamSession(ctx context.Context, baseURL, bearerToken, sessionID string, w io.Writer, flush func()) error {
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

	// All writes to w go through writeLine so the concurrent heartbeat ticker
	// below can never interleave bytes with the scan loop mid-line. Returns false
	// on a write error (client disconnect) so callers stop promptly.
	var writeMu sync.Mutex
	writeLine := func(b []byte) bool {
		writeMu.Lock()
		defer writeMu.Unlock()
		if _, err := w.Write(b); err != nil {
			return false
		}
		if flush != nil {
			flush()
		}
		return true
	}

	// Heartbeat: emit a langy.progress frame every progressInterval so the relay
	// keeps refreshing the turn's liveness key even through a long, silent tool
	// call — the scan loop blocks on upstream bytes and cannot self-tick through
	// silence. Best-effort; a write error just stops the ticker (the loop detects
	// the same disconnect). We wait for the goroutine to exit before returning so
	// no heartbeat write races the handler teardown.
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(progressInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				frame, mErr := json.Marshal(langyProgressFrame{Type: langyProgressType})
				if mErr != nil {
					continue
				}
				if !writeLine(append(frame, '\n')) {
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
	var out []byte // reused across the whole stream: one alloc/turn, not one/event
	var ev sseEvent
	tools := newToolCallTracker() // per-turn de-dupe of the tool start/end frames
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
		// Stream B fast-path: emit the raw token frame FIRST so time-to-first
		// token isn't gated on the heavy full-event line behind it. Best-effort —
		// a write error here means the client is gone, which the full-event write
		// below detects and returns on.
		if delta, ok := textDeltaFromEvent(&ev); ok {
			if frame, mErr := json.Marshal(langyTokenFrame{Type: langyTokenType, Text: delta}); mErr == nil {
				if !writeLine(append(frame, '\n')) {
					return nil // client disconnect.
				}
			}
		}
		// Tool lifecycle: emit the compact start/end frames ahead of the heavy
		// full-event line so the card opens as promptly as the tokens flow.
		// Best-effort — a marshal failure drops the frame and the turn keeps
		// streaming; forwarding must never fail a turn.
		for _, tf := range tools.framesFor(&ev) {
			frame, mErr := json.Marshal(tf)
			if mErr != nil {
				continue
			}
			if !writeLine(append(frame, '\n')) {
				return nil // client disconnect.
			}
		}
		// Forward the payload VERBATIM, newline-terminated. payload aliases the
		// scanner buffer (valid only until the next Scan); appending into out
		// copies it out before Write.
		out = append(out[:0], payload...)
		out = append(out, '\n')
		if !writeLine(out) {
			return nil // client disconnect — opencode keeps producing, but we're done.
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
