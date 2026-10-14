package mcpsim

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
)

// plan is a checked RunRequest.
type plan struct {
	RunRequest
	persona    persona
	transports []string
	hold, idle time.Duration
	duration   time.Duration
	tool       string // the tool connect calls: Tool, or fetch_langwatch_docs
}

const defaultTool = "fetch_langwatch_docs"

func (s *Server) plan(req RunRequest) (*plan, error) {
	p := &plan{RunRequest: req}
	p.Endpoint = strings.TrimRight(cmp.Or(req.Endpoint, s.cfg.Endpoint), "/")
	p.Flow = cmp.Or(req.Flow, FlowAPIKey)
	if err := s.planFlow(p, req.Endpoint != ""); err != nil {
		return p, err
	}
	if err := checkEndpoint(p.Endpoint); err != nil {
		return p, err
	}
	var ok bool
	if p.persona, ok = personas[cmp.Or(req.Client, "claude-code")]; !ok {
		return p, fmt.Errorf("client %q is not claude-code, claude-desktop or cursor", req.Client)
	}
	transports, err := transportsOf(req)
	if err != nil {
		return p, err
	}
	p.transports = transports
	p.tool = cmp.Or(req.Tool, defaultTool)
	err = p.checkScenario()
	return p, err
}

// planFlow fills the credentials the flow presents.
func (s *Server) planFlow(p *plan, endpointGiven bool) error {
	switch p.Flow {
	case FlowAPIKey:
		// The configured key only ever goes to the configured endpoint.
		if p.Endpoint == s.cfg.Endpoint {
			p.APIKey = cmp.Or(p.APIKey, s.cfg.APIKey)
		}
		if p.APIKey == "" {
			return errors.New("the apikey flow needs a project API key: pass apiKey or set MCPSIM_API_KEY")
		}
	case FlowOAuth:
		g := s.grants.current()
		if g == nil {
			return errors.New("the oauth flow needs a grant: run the OAuth connect first (POST /_sim/api/oauth/connect, haven sim mcp oauth)")
		}
		if !endpointGiven {
			p.Endpoint = g.endpoint
		}
	default:
		return fmt.Errorf("flow %q is neither apikey nor oauth", p.Flow)
	}
	return nil
}

// transportsOf is the paths a run uses; connect defaults to both.
func transportsOf(req RunRequest) ([]string, error) {
	switch req.Transport {
	case "":
		if req.Scenario == ScenarioConnect {
			return []string{"/mcp", "/sse"}, nil
		}
		return []string{"/mcp"}, nil
	case "/mcp", "mcp":
		return []string{"/mcp"}, nil
	case "/sse", "sse":
		return []string{"/sse"}, nil
	case "both":
		return []string{"/mcp", "/sse"}, nil
	}
	return nil, fmt.Errorf("transport %q is not /mcp, /sse or both", req.Transport)
}

// secondsOr is n seconds (fallback when unset), refused outside 1..maxHold.
func secondsOr(n, fallback int, what string) (time.Duration, error) {
	if n == 0 {
		n = fallback
	}
	if n < 0 || time.Duration(n)*time.Second > maxHold {
		return 0, fmt.Errorf("%s takes 1 to %d seconds", what, int(maxHold.Seconds()))
	}
	return time.Duration(n) * time.Second, nil
}

func (p *plan) checkScenario() error {
	var err error
	switch p.Scenario {
	case ScenarioConnect, ScenarioReconnect:
	case ScenarioStream:
		p.hold, err = secondsOr(p.HoldSeconds, 60, "holdSeconds")
	case ScenarioIdle:
		p.idle, err = secondsOr(p.IdleSeconds, 30, "idleSeconds")
	case ScenarioRefresh, ScenarioDoubleRefresh:
		if p.Flow != FlowOAuth {
			err = fmt.Errorf("%s needs the oauth flow", p.Scenario)
		}
	case ScenarioSoak:
		err = p.checkSoak()
	case ScenarioOAuthConnect:
		err = errors.New("oauth-connect starts at POST /_sim/api/oauth/connect")
	default:
		names := make([]string, 0, len(scenarios))
		for _, sc := range scenarios {
			names = append(names, sc.Name)
		}
		err = fmt.Errorf("unknown scenario %q; scenarios: %s", p.Scenario, strings.Join(names, ", "))
	}
	return err
}

func (p *plan) checkSoak() error {
	p.Clients = cmp.Or(p.Clients, 10)
	if p.Clients < 1 || p.Clients > maxClients {
		return fmt.Errorf("soak takes 1 to %d clients", maxClients)
	}
	d, err := time.ParseDuration(cmp.Or(p.Duration, "1m"))
	if err != nil || d <= 0 || d > maxDuration {
		return fmt.Errorf("soak takes a duration up to %s, e.g. 5m", maxDuration)
	}
	p.duration = d
	return nil
}

// scenario is one run of a plan.
type scenario struct {
	s  *Server
	rn *run
	p  *plan
}

func (sc scenario) client(path string) *mcpClient { return sc.s.newClient(sc.rn, sc.p, path) }

func (s *Server) execute(ctx context.Context, rn *run, p *plan) error {
	sc := scenario{s: s, rn: rn, p: p}
	switch p.Scenario {
	case ScenarioConnect:
		sc.eachTransport(ctx, sc.connectOn)
	case ScenarioStream:
		sc.eachTransport(ctx, sc.streamOn)
	case ScenarioReconnect:
		sc.eachTransport(ctx, sc.reconnectOn)
	case ScenarioRefresh:
		return sc.refresh(ctx)
	case ScenarioDoubleRefresh:
		return sc.doubleRefresh(ctx)
	case ScenarioIdle:
		return sc.idle(ctx)
	case ScenarioSoak:
		return sc.soak(ctx)
	}
	return ctx.Err()
}

func (sc scenario) eachTransport(ctx context.Context, each func(context.Context, string)) {
	for _, path := range sc.p.transports {
		if ctx.Err() != nil {
			return
		}
		each(ctx, path)
	}
}

// open initializes a client on path, checking that it worked.
func (sc scenario) open(ctx context.Context, path string) (*mcpClient, bool) {
	c := sc.client(path)
	err := c.initialize(ctx)
	if err != nil {
		sc.rn.check("initialize on "+path+" opens a session", false, err.Error())
	}
	return c, err == nil
}

// connectOn is what a client does on first use: initialize, list tools, call one, end.
func (sc scenario) connectOn(ctx context.Context, path string) {
	c := sc.client(path)
	err := c.initialize(ctx)
	sc.rn.check("initialize on "+path+" opens a session", err == nil, errString(err))
	if err != nil {
		return
	}
	result, err := c.call(ctx, kindToolsList, map[string]any{})
	names := toolNames(result)
	sc.rn.check("tools/list on "+path+" lists tools", err == nil && len(names) > 0, firstOf(errString(err), fmt.Sprintf("%d tools", len(names))))
	if err == nil {
		sc.callTool(ctx, c, names)
	}
	err = c.end(ctx)
	sc.rn.check("DELETE on "+path+" ends the session", err == nil, errString(err))
}

func (sc scenario) callTool(ctx context.Context, c *mcpClient, names []string) {
	tool := sc.p.tool
	if !contains(names, tool) {
		sc.rn.check("tools/list on "+c.path+" offers "+tool, false, "not among the listed tools")
		return
	}
	_, err := c.call(ctx, "tools/call", map[string]any{"name": tool, "arguments": orEmpty(sc.p.ToolArgs)})
	sc.rn.check("tools/call "+tool+" on "+c.path+" answers", err == nil, errString(err))
}

func toolNames(result json.RawMessage) []string {
	var list struct {
		Tools []struct {
			Name string `json:"name"`
		} `json:"tools"`
	}
	_ = json.Unmarshal(result, &list)
	names := make([]string, 0, len(list.Tools))
	for _, t := range list.Tools {
		names = append(names, t.Name)
	}
	return names
}

func contains(values []string, v string) bool { return slices.Contains(values, v) }

// streamOn holds the GET event stream and reports if and when it was dropped.
func (sc scenario) streamOn(ctx context.Context, path string) {
	c, ok := sc.open(ctx, path)
	if !ok {
		return
	}
	hold := sc.p.hold
	res := c.hold(ctx, hold)
	sc.rn.check("GET on "+path+" opens the event stream", res.opened, fmt.Sprintf("%d %s", res.status, res.lastError))
	if res.opened {
		detail := fmt.Sprintf("held %.1fs of %s; %d events, %d keepalive comments", res.heldFor.Seconds(), hold, res.events, res.comments)
		if res.dropped {
			detail = fmt.Sprintf("dropped after %.1fs of %s (%s); %d events, %d keepalive comments", res.heldFor.Seconds(), hold, res.lastError, res.events, res.comments)
		}
		c.note("stream-end", detail, !res.dropped)
		sc.rn.check("the event stream on "+path+" stays open for "+hold.String(), !res.dropped, detail)
	}
	// The session must still answer after the stream: a dropped stream is not a lost session.
	_, err := c.call(ctx, kindToolsList, map[string]any{})
	sc.rn.check("the session on "+path+" still answers after the stream", err == nil && c.reinits == 0, sessionDetail(c, err))
	_ = c.end(ctx)
}

func sessionDetail(c *mcpClient, err error) string {
	if err != nil {
		return err.Error()
	}
	if c.reinits > 0 {
		return fmt.Sprintf("the session was lost (404) and re-initialized %d times", c.reinits)
	}
	return ""
}

// refresh refreshes the token mid-session and keeps the same session id.
func (sc scenario) refresh(ctx context.Context) error {
	c, ok := sc.open(ctx, sc.p.transports[0])
	if !ok {
		return nil
	}
	if _, err := c.call(ctx, kindToolsList, map[string]any{}); err != nil {
		sc.rn.check("tools/list answers before the refresh", false, err.Error())
		return err
	}
	before, session := sc.s.grants.accessToken(), c.sessionID
	err := sc.s.refreshNow(ctx, sc.rn)
	after := sc.s.grants.accessToken()
	sc.rn.check("the refresh answers a new access token", err == nil && after != "" && after != before, firstOf(errString(err), "access "+hint(after)))
	if err != nil {
		return err
	}
	c.reinitOn404 = false
	_, err = c.call(ctx, kindToolsList, map[string]any{})
	sc.rn.check("the same session id answers with the new token", err == nil && c.sessionID == session && c.refreshes == 0,
		firstOf(errString(err), fmt.Sprintf("session %s, refreshes after %d", hint(c.sessionID), c.refreshes)))
	_ = c.end(ctx)
	return nil
}

// doubleRefresh redeems one refresh token twice at once, as two windows of one client do.
func (sc scenario) doubleRefresh(ctx context.Context) error {
	g := sc.s.grants.current()
	if g == nil {
		return errors.New("no OAuth grant")
	}
	answers, errs := sc.s.refreshTwice(ctx, sc.rn, g)
	both := errs[0] == nil && errs[1] == nil
	sc.rn.check("both concurrent refreshes succeed", both, joinErrs(errs))
	same := both && answers[0].AccessToken == answers[1].AccessToken && answers[0].RefreshToken == answers[1].RefreshToken
	detail := ""
	if both && !same {
		detail = fmt.Sprintf("first %s/%s, second %s/%s", hint(answers[0].AccessToken), hint(answers[0].RefreshToken), hint(answers[1].AccessToken), hint(answers[1].RefreshToken))
	}
	sc.rn.check("both answer the same new token pair", same, detail)
	if errs[0] != nil && errs[1] != nil {
		return errors.New("neither refresh answered a pair")
	}
	c, ok := sc.open(ctx, sc.p.transports[0])
	if !ok {
		return nil
	}
	_, err := c.call(ctx, kindToolsList, map[string]any{})
	_ = c.end(ctx)
	sc.rn.check("the kept pair opens a session", err == nil, errString(err))
	return nil
}

// refreshTwice redeems g's refresh token twice at once and keeps the first pair that came back.
// It holds refreshMu so no client refreshes in between.
func (s *Server) refreshTwice(ctx context.Context, rn *run, g *grant) ([]tokenAnswer, []error) {
	s.grants.refreshMu.Lock()
	defer s.grants.refreshMu.Unlock()
	var wg sync.WaitGroup
	answers := make([]tokenAnswer, 2)
	errs := make([]error, 2)
	for i := range 2 {
		wg.Go(func() {
			answers[i], errs[i] = s.redeemRefresh(ctx, rn, refreshCall{g: g, kind: fmt.Sprintf("refresh %d", i+1)})
		})
	}
	wg.Wait()
	for i := range 2 {
		if errs[i] == nil {
			s.grants.adopt(g.refresh, answers[i])
			break
		}
	}
	return answers, errs
}

func joinErrs(errs []error) string {
	var parts []string
	for i, err := range errs {
		if err != nil {
			parts = append(parts, fmt.Sprintf("refresh %d: %s", i+1, err))
		}
	}
	return strings.Join(parts, "; ")
}

// reconnectOn loses the session twice (a session id the server never issued, and
// one it has ended) and expects 404, then a re-initialize with no new sign-in.
func (sc scenario) reconnectOn(ctx context.Context, path string) {
	c, ok := sc.open(ctx, path)
	if !ok {
		return
	}
	issued := c.sessionID
	c.sessionID = "mcpsim-lost-" + randomToken(12)
	sc.expectLost(ctx, c, "an unknown session id")
	c.sessionID = issued
	if err := c.end(ctx); err == nil {
		c.sessionID = issued
		sc.expectLost(ctx, c, "an ended session id")
	}
	_ = c.end(ctx)
}

// expectLost asks with a lost session id: it must answer 404, and a re-initialize
// with the same credentials must work without any refresh or sign-in.
func (sc scenario) expectLost(ctx context.Context, c *mcpClient, what string) {
	c.note("lose-session", "ask with "+what+": "+hint(c.sessionID), true)
	c.reinitOn404 = false
	x, err := c.send(ctx, map[string]any{"jsonrpc": "2.0", "id": c.nextID.Add(1), "method": kindToolsList}, true)
	detail := fmt.Sprintf("answered %d", x.status)
	if x.status == http.StatusUnauthorized {
		detail += ": a spec client would start a new sign-in for a session that is merely gone"
	}
	sc.rn.check(what+" on "+c.path+" answers 404", errors.Is(err, errSessionLost) && x.status == http.StatusNotFound, detail)
	refreshes := c.refreshes + sc.s.grants.status().Refreshes
	c.reinitOn404 = true
	err = c.initialize(ctx)
	if err == nil {
		_, err = c.call(ctx, kindToolsList, map[string]any{})
	}
	sc.rn.check("after "+what+", re-initializing on "+c.path+" works without a new sign-in",
		err == nil && c.refreshes+sc.s.grants.status().Refreshes == refreshes, errString(err))
}

// idle sleeps, then reuses the session.
func (sc scenario) idle(ctx context.Context) error {
	c, ok := sc.open(ctx, sc.p.transports[0])
	if !ok {
		return nil
	}
	if _, err := c.call(ctx, kindToolsList, map[string]any{}); err != nil {
		sc.rn.check("tools/list answers before the idle", false, err.Error())
		return err
	}
	c.note("sleep", "idle for "+sc.p.idle.String(), true)
	if !sc.s.sleep(ctx, sc.p.idle) {
		return ctx.Err()
	}
	_, err := c.call(ctx, kindToolsList, map[string]any{})
	sc.rn.check("the session answers after "+sc.p.idle.String()+" idle", err == nil, errString(err))
	if err == nil {
		c.note("after-idle", afterIdle(c), true)
	}
	_ = c.end(ctx)
	return nil
}

func afterIdle(c *mcpClient) string {
	switch {
	case c.reinits > 0:
		return "the session was gone (404) and the client re-initialized, as the spec asks"
	case c.refreshes > 0:
		return "the token was refreshed after a 401"
	}
	return "the same session answered"
}

// soak runs N clients for a duration, each looping tools/list (and the tool
// when one was named) about once a second, re-initializing as needed.
func (sc scenario) soak(ctx context.Context) error {
	p := sc.p
	sc.rn.update(func(st *RunStatus) { st.Load = &LoadStats{Clients: p.Clients} })
	ctx, cancel := context.WithTimeout(ctx, p.duration)
	defer cancel()
	var wg sync.WaitGroup
	for i := range p.Clients {
		wg.Go(func() { sc.soakClient(ctx, p.transports[i%len(p.transports)]) })
	}
	wg.Wait()
	l := sc.rn.snapshot(false).Load
	sc.rn.check(fmt.Sprintf("%d clients for %s with no failed request", p.Clients, p.duration), l.Errors == 0 && l.Sessions > 0,
		fmt.Sprintf("%d requests, %d sessions, %d errors, %d re-initialized, %d refreshed, %d retried",
			l.Requests, l.Sessions, l.Errors, l.Reinitialized, l.Refreshed, l.Retried))
	return nil
}

// soakClient is one client of a soak, until ctx ends.
func (sc scenario) soakClient(ctx context.Context, path string) {
	c := sc.client(path)
	c.quiet = true
	defer func() { _ = c.end(context.WithoutCancel(ctx)) }()
	// Spread the first initializes over a second, as clients starting up would.
	if !sc.s.sleep(ctx, jitter(time.Second)) {
		return
	}
	for n := 0; ctx.Err() == nil; n++ {
		if c.sessionID == "" && c.initialize(ctx) != nil {
			sc.s.sleep(ctx, time.Second)
			continue
		}
		if sc.p.Tool != "" && n%5 == 4 {
			_, _ = c.call(ctx, "tools/call", map[string]any{"name": sc.p.tool, "arguments": orEmpty(sc.p.ToolArgs)})
		} else {
			_, _ = c.call(ctx, kindToolsList, map[string]any{})
		}
		sc.s.sleep(ctx, 900*time.Millisecond+jitter(200*time.Millisecond))
	}
}

// jitter is a random duration below d.
func jitter(d time.Duration) time.Duration {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return time.Duration(binary.LittleEndian.Uint64(b[:]) % uint64(d))
}

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}
