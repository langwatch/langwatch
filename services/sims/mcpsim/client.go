package mcpsim

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
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
	// shouldReinitOn404 re-initializes silently when the session is lost, as a spec client does.
	shouldReinitOn404 bool
	// isQuiet records only failed steps and initializes (soak).
	isQuiet bool
	// what the client had to do to keep going, for the scenario's checks
	reinits, refreshes, retries int
}

func (s *Server) newClient(rn *run, p *plan, path string) *mcpClient {
	return &mcpClient{
		s: s, rn: rn, endpoint: p.Endpoint, path: path, flow: p.Flow, apiKey: p.APIKey,
		persona: p.persona, shouldReinitOn404: true,
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
		x.message, x.err = readSSEAnswer(io.LimitReader(resp.Body, answerBodyLimit), id)
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
	if c.isQuiet && o.ok && o.kind != kindInitialize {
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
