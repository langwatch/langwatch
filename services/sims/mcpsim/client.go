package mcpsim

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// persona is the MCP client mcpsim stands in for: the clientInfo it announces,
// the protocol version it asks for and its User-Agent.
type persona struct {
	name, clientName, version, protocol string
}

var personas = map[string]persona{
	"claude-code":    {"claude-code", "claude-code", "2.1.0", "2025-06-18"},
	"claude-desktop": {"claude-desktop", "claude-ai", "0.1.0", "2025-06-18"},
	"cursor":         {"cursor", "cursor-vscode", "1.0.0", "2025-03-26"},
}

const (
	maxRetries      = 3                      // 503, 502, 504 or no answer: backoff retries per request
	maxRetryWait    = 5 * time.Second        // the longest Retry-After mcpsim honors
	firstBackoff    = 250 * time.Millisecond // doubled per retry
	answerBodyLimit = 1 << 20
	requestTimeout  = 60 * time.Second
	kindInitialize  = "initialize"
	kindToolsList   = "tools/list"
)

// errSessionLost is a request answered 404 for its session id while the client
// was told not to re-initialize (reconnect observes the raw answer this way).
var errSessionLost = errors.New("the session id is unknown to the server (404)")

// rpcError is a JSON-RPC error answer.
type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *rpcError) Error() string { return fmt.Sprintf("JSON-RPC error %d: %s", e.Code, e.Message) }

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// mcpClient is one simulated MCP client on one transport path, speaking
// Streamable HTTP: POST JSON-RPC, answers as JSON or an SSE body, the session id
// in mcp-session-id, GET for the server's event stream and DELETE to end.
type mcpClient struct {
	s         *Server
	rn        *run
	endpoint  string
	path      string // /mcp or /sse
	flow      string
	apiKey    string
	persona   persona
	sessionID string
	protocol  string // negotiated by initialize
	nextID    atomic.Int64
	// reinitOn404 re-initializes silently when the session is lost, as a spec client does.
	reinitOn404 bool
	// quiet records only failed steps and initializes (soak).
	quiet bool
	// what the client had to do to keep going, for the scenario's checks
	reinits, refreshes, retries int
}

func (s *Server) newClient(rn *run, p *plan, path string) *mcpClient {
	return &mcpClient{
		s: s, rn: rn, endpoint: p.Endpoint, path: path, flow: p.Flow, apiKey: p.APIKey,
		persona: p.persona, reinitOn404: true,
	}
}

func (c *mcpClient) url() string { return c.endpoint + c.path }

// bearer is the token this client presents: the API key, or the grant's access token.
func (c *mcpClient) bearer() string {
	if c.flow == FlowOAuth {
		return c.s.grants.accessToken()
	}
	return c.apiKey
}

// exchange is one HTTP attempt's answer.
type exchange struct {
	status    int
	header    http.Header
	body      []byte
	message   *rpcMessage // the JSON-RPC answer, from a JSON or an SSE body
	took      time.Duration
	err       error
	sessionID string
}

// post sends one JSON-RPC message and reads its answer.
func (c *mcpClient) post(ctx context.Context, msg map[string]any) exchange {
	body, _ := json.Marshal(msg)
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url(), bytes.NewReader(body))
	if err != nil {
		return exchange{err: err}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	c.decorate(req)
	began := time.Now()
	resp, err := c.s.http.Do(req)
	if err != nil {
		return exchange{err: err, took: time.Since(began)}
	}
	defer func() { _ = resp.Body.Close() }()
	x := readAnswer(resp, msg["id"])
	x.took = time.Since(began)
	return x
}

// readAnswer reads the JSON-RPC answer to id (nil for a notification) from a JSON or an SSE body.
func readAnswer(resp *http.Response, id any) exchange {
	x := exchange{status: resp.StatusCode, header: resp.Header, sessionID: resp.Header.Get("mcp-session-id")}
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") && id != nil {
		x.message, x.err = readSSEAnswer(resp.Body, id)
		return x
	}
	x.body, _ = io.ReadAll(io.LimitReader(resp.Body, answerBodyLimit))
	if id == nil || resp.StatusCode != http.StatusOK {
		return x
	}
	var m rpcMessage
	if err := json.Unmarshal(x.body, &m); err != nil {
		x.err = fmt.Errorf("the answer is not JSON-RPC: %w", err)
	} else {
		x.message = &m
	}
	return x
}

func (c *mcpClient) decorate(req *http.Request) {
	if b := c.bearer(); b != "" {
		req.Header.Set("Authorization", "Bearer "+b)
	}
	if c.sessionID != "" {
		req.Header.Set("mcp-session-id", c.sessionID)
	}
	if c.protocol != "" {
		req.Header.Set("MCP-Protocol-Version", c.protocol)
	}
	req.Header.Set("User-Agent", "mcpsim ("+c.persona.name+")")
}

// readSSEAnswer reads an SSE body until the message answering id arrives.
func readSSEAnswer(r io.Reader, id any) (*rpcMessage, error) {
	want, _ := json.Marshal(id)
	var found *rpcMessage
	err := readSSE(r, func(ev sseEvent) bool {
		var m rpcMessage
		if ev.comment || json.Unmarshal([]byte(ev.data), &m) != nil || !bytes.Equal(bytes.TrimSpace(m.ID), want) {
			return true
		}
		found = &m
		return false
	})
	if found != nil {
		return found, nil
	}
	if err == nil {
		err = errors.New("the event stream ended before the answer arrived")
	}
	return nil, err
}

type sseEvent struct {
	event, data string
	comment     bool
}

// sseParser assembles events from lines.
type sseParser struct {
	ev   sseEvent
	data []string
}

// line takes one line and answers an event (or comment) when one is complete.
func (p *sseParser) line(line string) (sseEvent, bool) {
	switch {
	case line == "":
		if len(p.data) == 0 && p.ev.event == "" {
			return sseEvent{}, false
		}
		ev := p.ev
		ev.data = strings.Join(p.data, "\n")
		p.ev, p.data = sseEvent{}, nil
		return ev, true
	case strings.HasPrefix(line, ":"):
		return sseEvent{comment: true, data: strings.TrimSpace(line[1:])}, true
	case strings.HasPrefix(line, "data:"):
		p.data = append(p.data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
	case strings.HasPrefix(line, "event:"):
		p.ev.event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
	}
	return sseEvent{}, false
}

// readSSE calls each with every event (and comment) until it answers false or the stream ends.
func readSSE(r io.Reader, each func(sseEvent) bool) error {
	br := bufio.NewReaderSize(r, 64<<10)
	var p sseParser
	for {
		line, err := br.ReadString('\n')
		if ev, ok := p.line(strings.TrimRight(line, "\r\n")); ok && !each(ev) {
			return nil
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// outcome is one attempt as a step will show it.
type outcome struct {
	kind, method, detail string
	x                    exchange
	ok                   bool
}

// record turns an attempt into a step.
func (c *mcpClient) record(o outcome) {
	st := Step{
		At: time.Now().UTC(), Kind: o.kind, Flow: c.flow, Transport: c.path, Method: o.method, URL: c.url(),
		Status: o.x.status, LatencyMs: ms(o.x.took), OK: o.ok, Session: hint(c.sessionID), Detail: o.detail,
		Error: errorOf(o.x, o.ok),
	}
	c.rn.attempt(o.x.status, o.x.took)
	if c.quiet && o.ok && o.kind != kindInitialize {
		return
	}
	c.rn.step(st)
}

// errorOf is what went wrong in an attempt, for its step.
func errorOf(x exchange, ok bool) string {
	switch {
	case x.err != nil:
		return x.err.Error()
	case x.message != nil && x.message.Error != nil:
		return x.message.Error.Error()
	case !ok && len(x.body) > 0:
		return clip(string(x.body), 300)
	}
	return ""
}

func (c *mcpClient) note(kind, detail string, ok bool) {
	c.rn.step(Step{At: time.Now().UTC(), Kind: kind, Flow: c.flow, Transport: c.path, OK: ok, Session: hint(c.sessionID), Detail: detail})
}

// initialize opens a session: initialize, then notifications/initialized.
func (c *mcpClient) initialize(ctx context.Context) error {
	c.sessionID, c.protocol = "", ""
	msg := map[string]any{"jsonrpc": "2.0", "id": c.nextID.Add(1), "method": kindInitialize, "params": map[string]any{
		"protocolVersion": c.persona.protocol, "capabilities": map[string]any{},
		"clientInfo": map[string]any{"name": c.persona.clientName, "version": c.persona.version},
	}}
	x, err := c.send(ctx, msg, false)
	if err != nil {
		return err
	}
	if x.sessionID == "" {
		return errors.New("initialize answered without an mcp-session-id header")
	}
	c.sessionID = x.sessionID
	var result struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	_ = json.Unmarshal(x.message.Result, &result)
	c.protocol = result.ProtocolVersion
	c.rn.counted(func(l *LoadStats) { l.Sessions++ })
	_, err = c.send(ctx, map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"}, true)
	return err
}

// call sends a request in the session and answers its result.
func (c *mcpClient) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	msg := map[string]any{"jsonrpc": "2.0", "id": c.nextID.Add(1), "method": method}
	if params != nil {
		msg["params"] = params
	}
	x, err := c.send(ctx, msg, true)
	if err != nil {
		return nil, err
	}
	return x.message.Result, nil
}

// attemptState is what one send has already done to recover.
type attemptState struct {
	kind                     string
	inSession                bool
	attempt                  int
	refreshed, reinitialized bool
}

// send delivers msg and recovers the way a spec client does: a lost session (404)
// re-initializes without signing in again, a 401 refreshes the OAuth token and
// retries, a 503 (or 502, 504, no answer) backs off and retries.
func (c *mcpClient) send(ctx context.Context, msg map[string]any, inSession bool) (exchange, error) {
	st := &attemptState{kind: msg["method"].(string), inSession: inSession}
	for ; ; st.attempt++ {
		x := c.post(ctx, msg)
		retry, err := c.handle(ctx, st, x)
		if !retry {
			return x, err
		}
	}
}

// handle decides what one answer means: done, done with an error, or try again.
func (c *mcpClient) handle(ctx context.Context, st *attemptState, x exchange) (bool, error) {
	switch {
	case answered(x, strings.HasPrefix(st.kind, "notifications/")):
		c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, ok: true, detail: okDetail(st.kind, x)})
		return false, nil
	case ctx.Err() != nil:
		c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, detail: "stopped"})
		return false, ctx.Err()
	case x.status == http.StatusNotFound && st.inSession && c.sessionID != "":
		return c.onLost(ctx, st, x)
	case x.status == http.StatusUnauthorized && c.flow == FlowOAuth && !st.refreshed:
		return c.onUnauthorized(ctx, st, x)
	case retryable(x) && st.attempt < maxRetries:
		return c.onUnavailable(ctx, st, x)
	}
	detail := failDetail(x)
	c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, detail: detail})
	c.rn.counted(func(l *LoadStats) { l.Errors++ })
	return false, fmt.Errorf("%s on %s: %s", st.kind, c.path, firstOf(errText(x), detail))
}

// answered is a 2xx for a notification, or a 200 carrying a JSON-RPC result for a request.
func answered(x exchange, notification bool) bool {
	switch {
	case x.err != nil:
		return false
	case notification:
		return x.status/100 == 2
	}
	return x.status == http.StatusOK && x.message != nil && x.message.Error == nil
}

// onLost is the spec's answer to a 404 for the session: open a new one with the same credentials.
func (c *mcpClient) onLost(ctx context.Context, st *attemptState, x exchange) (bool, error) {
	c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, ok: !st.reinitialized, detail: "session lost (404)"})
	if !c.reinitOn404 {
		return false, errSessionLost
	}
	if st.reinitialized {
		return false, errors.New("the session was lost again right after re-initializing")
	}
	st.reinitialized = true
	c.reinits++
	c.rn.counted(func(l *LoadStats) { l.Reinitialized++ })
	c.note("re-initialize", "a spec client opens a new session with the same credentials, no new sign-in", true)
	if err := c.initialize(ctx); err != nil {
		return false, fmt.Errorf("re-initializing after a lost session: %w", err)
	}
	return true, nil
}

// onUnauthorized refreshes the OAuth token once and retries.
func (c *mcpClient) onUnauthorized(ctx context.Context, st *attemptState, x exchange) (bool, error) {
	c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, ok: true, detail: "401: refresh the token and retry; " + challengeOf(x)})
	st.refreshed = true
	c.refreshes++
	c.rn.counted(func(l *LoadStats) { l.Refreshed++ })
	if err := c.s.refreshAfter(ctx, c.rn); err != nil {
		return false, fmt.Errorf("refreshing after a 401 (a real client would ask the person to sign in again): %w", err)
	}
	return true, nil
}

// onUnavailable backs off and retries.
func (c *mcpClient) onUnavailable(ctx context.Context, st *attemptState, x exchange) (bool, error) {
	wait := backoff(x, st.attempt)
	c.record(outcome{kind: st.kind, method: http.MethodPost, x: x, ok: true, detail: fmt.Sprintf("retry in %s", wait)})
	c.retries++
	c.rn.counted(func(l *LoadStats) { l.Retried++ })
	if !c.s.sleep(ctx, wait) {
		return false, ctx.Err()
	}
	return true, nil
}

// end closes the session with DELETE.
func (c *mcpClient) end(ctx context.Context) error {
	if c.sessionID == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.url(), nil)
	if err != nil {
		return err
	}
	c.decorate(req)
	began := time.Now()
	resp, err := c.s.http.Do(req)
	x := exchange{err: err, took: time.Since(began)}
	if resp != nil {
		x.status = resp.StatusCode
		x.body, _ = io.ReadAll(io.LimitReader(resp.Body, answerBodyLimit))
		_ = resp.Body.Close()
	}
	ok := err == nil && x.status/100 == 2
	c.record(outcome{kind: "delete", method: http.MethodDelete, x: x, ok: ok, detail: "end the session"})
	if !ok {
		return fmt.Errorf("DELETE answered %d", x.status)
	}
	c.sessionID = ""
	return nil
}

// streamResult is how a held GET event stream ended.
type streamResult struct {
	status    int
	opened    bool
	heldFor   time.Duration
	dropped   bool // the server or a proxy ended it before the hold was up
	events    int
	comments  int
	lastError string
}

// hold opens the server-to-client event stream and keeps it until hold is up or it drops.
func (c *mcpClient) hold(parent context.Context, hold time.Duration) streamResult {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	began := time.Now()
	resp, res := c.openStream(ctx)
	if resp == nil {
		return res
	}
	defer func() { _ = resp.Body.Close() }()
	c.record(outcome{kind: "stream", method: http.MethodGet, x: exchange{status: resp.StatusCode, took: time.Since(began)}, ok: true,
		detail: "event stream open; holding " + hold.String()})
	var expired atomic.Bool
	timer := time.AfterFunc(hold, func() { expired.Store(true); cancel() })
	defer timer.Stop()
	err := readSSE(resp.Body, func(ev sseEvent) bool {
		if ev.comment {
			res.comments++
		} else {
			res.events++
		}
		return true
	})
	res.heldFor = time.Since(began)
	switch {
	case expired.Load():
	case parent.Err() != nil:
		res.lastError = "stopped"
	default:
		res.dropped, res.lastError = true, firstOf(errString(err), "the stream ended (EOF)")
	}
	return res
}

// openStream sends the GET; a nil response means it did not open (and was recorded).
func (c *mcpClient) openStream(ctx context.Context) (*http.Response, streamResult) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url(), nil)
	if err != nil {
		return nil, streamResult{lastError: err.Error()}
	}
	req.Header.Set("Accept", "text/event-stream")
	c.decorate(req)
	began := time.Now()
	resp, err := c.s.http.Do(req)
	if err != nil {
		c.record(outcome{kind: "stream", method: http.MethodGet, x: exchange{err: err, took: time.Since(began)}, detail: "open the event stream"})
		return nil, streamResult{lastError: err.Error()}
	}
	res := streamResult{status: resp.StatusCode, opened: true}
	if resp.StatusCode == http.StatusOK && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return resp, res
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()
	c.record(outcome{kind: "stream", method: http.MethodGet, x: exchange{status: resp.StatusCode, body: body, took: time.Since(began)},
		detail: "the event stream did not open: " + resp.Header.Get("Content-Type")})
	return nil, streamResult{status: resp.StatusCode}
}

func retryable(x exchange) bool {
	return x.err != nil || x.status == http.StatusServiceUnavailable || x.status == http.StatusBadGateway || x.status == http.StatusGatewayTimeout
}

// backoff is Retry-After where the server named one (up to maxRetryWait), else doubling from firstBackoff.
func backoff(x exchange, attempt int) time.Duration {
	if x.header != nil {
		if secs, err := strconv.Atoi(x.header.Get("Retry-After")); err == nil && secs >= 0 {
			return min(time.Duration(secs)*time.Second, maxRetryWait)
		}
	}
	return firstBackoff << attempt
}

func challengeOf(x exchange) string {
	if x.header == nil {
		return ""
	}
	if c := x.header.Get("WWW-Authenticate"); c != "" {
		return "WWW-Authenticate: " + c
	}
	return "no WWW-Authenticate challenge"
}

func okDetail(kind string, x exchange) string {
	switch {
	case kind == kindInitialize:
		return "session " + hint(x.sessionID)
	case x.message != nil && strings.Contains(string(x.message.Result), `"isError":true`):
		return "answered, the tool reported an error"
	}
	return ""
}

func failDetail(x exchange) string {
	switch x.status {
	case http.StatusUnauthorized:
		return "401: the bearer was refused; " + challengeOf(x)
	case http.StatusNotFound:
		return "404 before any session was open"
	case http.StatusServiceUnavailable:
		return "503 after every retry"
	case 0:
		return "no answer"
	}
	return fmt.Sprintf("answered %d", x.status)
}

func errText(x exchange) string {
	if x.err != nil {
		return x.err.Error()
	}
	if x.message != nil && x.message.Error != nil {
		return x.message.Error.Error()
	}
	return ""
}

func firstOf(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }

// hint shows a secret's or id's first six and last four characters.
func hint(v string) string {
	if v == "" {
		return ""
	}
	if len(v) < 16 {
		return v[:min(4, len(v))] + "…"
	}
	return v[:6] + "…" + v[len(v)-4:]
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
