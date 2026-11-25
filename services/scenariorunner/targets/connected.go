package targets

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

const (
	// busyRetryBudget is how long a busy agent is retried before giving up.
	busyRetryBudget = 60 * time.Second
	// busyRetryAfter is the wait when the relay names none (BUSY_RETRY_AFTER_MS).
	busyRetryAfter = 2 * time.Second
	// requestSlack is added to the agent's own budget for the HTTP request.
	requestSlack = 15 * time.Second
	// connectedCallFailurePrefix is what the failure classifier reads.
	connectedCallFailurePrefix = "Connected agent call failed"
)

// ConnectedAgent reaches a connected agent through the relay route, one POST
// per turn (http.serialized-connected-agent.channel.ts).
type ConnectedAgent struct {
	config        ConnectedAgentData
	projectAPIKey string
	parameters    *jsjson.Object
	logger        *zap.Logger
	client        *http.Client
	sleep         func(context.Context, time.Duration)
	sessions      sessions
	mu            sync.Mutex
	served        *Instance
}

// ConnectedAgentOptions build a ConnectedAgent.
type ConnectedAgentOptions struct {
	ProjectAPIKey string
	Parameters    *jsjson.Object
	Logger        *zap.Logger
	// Client posts the turns; nil uses a client that refuses redirects.
	Client *http.Client
}

// NewConnectedAgent returns the adapter.
func NewConnectedAgent(config ConnectedAgentData, opts ConnectedAgentOptions) *ConnectedAgent {
	client := opts.Client
	if client == nil {
		client = &http.Client{CheckRedirect: refuseRedirect}
	}
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	return &ConnectedAgent{
		config: config, projectAPIKey: opts.ProjectAPIKey, parameters: opts.Parameters,
		logger: logger, client: client, sleep: sleepContext,
	}
}

// errRedirectRefused stops a redirect that would carry X-Auth-Token elsewhere.
var errRedirectRefused = errors.New("redirect refused: the relay must answer on its own origin")

func refuseRedirect(*http.Request, []*http.Request) error { return errRedirectRefused }

func sleepContext(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// Name implements Agent.
func (a *ConnectedAgent) Name() string { return "SerializedConnectedAgentAdapter" }

// ServedInstance implements Served.
func (a *ConnectedAgent) ServedInstance() *Instance {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.served
}

func connectedError(code, message string) *Error {
	return &Error{
		Name:    "ConnectedAgentCallError",
		Code:    code,
		Message: connectedCallFailurePrefix + " (" + code + "): " + message,
	}
}

type relayResponse struct {
	status     int
	retryAfter string
	body       []byte
}

// Call implements Agent.
func (a *ConnectedAgent) Call(ctx context.Context, turn Turn) (string, error) {
	tc := traceContextOf(ctx)
	body := a.requestBody(turn, tc.Traceparent)
	url := trimTrailingSlash(a.config.Endpoint) + "/api/v1/agents/" + a.config.AgentID + "/call"
	headers := map[string]string{"Content-Type": "application/json", "X-Auth-Token": a.projectAPIKey}
	if tc.Traceparent != "" {
		headers["traceparent"] = tc.Traceparent
	}
	started := time.Now()
	resp, err := a.postUntilNotBusy(ctx, relayRequest{url: url, headers: headers, body: body})
	if err != nil {
		return "", err
	}
	if resp.status < 200 || resp.status >= 300 {
		return "", failureOf(resp)
	}
	return a.accept(turn, resp, started)
}

func (a *ConnectedAgent) requestBody(turn Turn, traceparent string) string {
	held, has := a.sessions.of(turn.ThreadID)
	obj := jsjson.NewObject().
		Set("messages", MessagesJSON(turn.Messages)).
		Set("newMessages", MessagesJSON(turn.NewMessages)).
		Set("threadId", turn.ThreadID).
		Set("params", paramsOrEmpty(a.parameters))
	if has {
		obj.Set("session", held)
	}
	if traceparent != "" {
		obj.Set("traceparent", traceparent)
	} else {
		obj.Set("traceparent", nil)
	}
	return jsjson.Stringify(obj)
}

func paramsOrEmpty(p *jsjson.Object) *jsjson.Object {
	if p == nil {
		return jsjson.NewObject()
	}
	return p
}

func (a *ConnectedAgent) postUntilNotBusy(ctx context.Context, req relayRequest) (relayResponse, error) {
	deadline := time.Now().Add(busyRetryBudget)
	resp, err := a.post(ctx, req)
	for err == nil && resp.status == http.StatusTooManyRequests && time.Now().Before(deadline) {
		retryAfter := retryAfterOf(resp.retryAfter)
		wait := min(retryAfter+time.Duration(rand.Int64N(int64(retryAfter))), time.Until(deadline)) //nolint:gosec // G404: jitter, not a secret
		a.logger.Info("connected agent busy, waiting before the next try",
			zap.String("agentId", a.config.AgentID), zap.Duration("wait", wait))
		a.sleep(ctx, max(0, wait))
		resp, err = a.post(ctx, req)
	}
	return resp, err
}

type relayRequest struct {
	url     string
	headers map[string]string
	body    string
}

func (a *ConnectedAgent) post(ctx context.Context, r relayRequest) (relayResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(a.config.TimeoutMs)*time.Millisecond+requestSlack)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.url, strings.NewReader(r.body))
	if err != nil {
		return relayResponse{}, connectedError("agent_relay_unreachable", err.Error())
	}
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return relayResponse{}, connectedError("agent_call_timeout", "The relay did not answer inside the call budget.")
		}
		return relayResponse{}, connectedError("agent_relay_unreachable", err.Error())
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return relayResponse{}, connectedError("agent_relay_unreachable", err.Error())
	}
	return relayResponse{status: resp.StatusCode, retryAfter: resp.Header.Get("Retry-After"), body: body}, nil
}

func (a *ConnectedAgent) accept(turn Turn, resp relayResponse, started time.Time) (string, error) {
	parsed, err := jsjson.Parse(resp.body)
	if err != nil {
		return "", &Error{Name: "SyntaxError", Message: err.Error()}
	}
	payload, _ := parsed.(*jsjson.Object)
	session := Absent
	if s, has := payload.Get("session"); has {
		session = s
	}
	if err := a.sessions.store(turn.ThreadID, session); err != nil {
		return "", err
	}
	instance := instanceOf(payload)
	a.mu.Lock()
	a.served = instance
	a.mu.Unlock()
	a.logger.Info("connected agent call ok", zap.String("agentId", a.config.AgentID), zap.Duration("duration", time.Since(started)))
	output, _ := payload.Get("output")
	if s, ok := output.(string); ok {
		return s, nil
	}
	return jsjson.ToText(output), nil
}

func instanceOf(payload *jsjson.Object) *Instance {
	raw, _ := payload.Get("instance")
	obj, ok := raw.(*jsjson.Object)
	if !ok {
		return nil
	}
	hostname, _ := obj.Get("hostname")
	host, _ := hostname.(string)
	label, _ := obj.Get("label")
	inst := &Instance{Hostname: host}
	if s, isString := label.(string); isString {
		inst.Label = &s
	}
	return inst
}

// failureOf turns the relay's error body into a typed error.
func failureOf(resp relayResponse) *Error {
	raw := string(resp.body)
	var parsed map[string]any
	if json.Unmarshal(resp.body, &parsed) != nil {
		parsed = map[string]any{}
	}
	message := preview(raw, 500, "")
	if m, ok := parsed["message"].(string); ok {
		message = m
	}
	if meta, ok := parsed["meta"].(map[string]any); ok {
		if m, isString := meta["message"].(string); isString && m != "" {
			message = m
		}
	}
	return connectedError(codeOf(parsed, resp.status), message)
}

func codeOf(parsed map[string]any, status int) string {
	if c, ok := parsed["code"].(string); ok && c != "" {
		return c
	}
	switch nested := parsed["error"].(type) {
	case map[string]any:
		if c, ok := nested["code"].(string); ok && c != "" {
			return c
		}
	case string:
		if nested != "" {
			return nested
		}
	}
	return "http_" + strconv.Itoa(status)
}

func retryAfterOf(header string) time.Duration {
	seconds, err := strconv.ParseFloat(strings.TrimSpace(header), 64)
	if err != nil || seconds <= 0 {
		return busyRetryAfter
	}
	return time.Duration(seconds * float64(time.Second))
}
