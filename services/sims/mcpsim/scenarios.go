package mcpsim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
)

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
	sc.rn.check("GET on "+path+" opens the event stream", res.isOpened, fmt.Sprintf("%d %s", res.status, res.lastError))
	if res.isOpened {
		detail := fmt.Sprintf("held %.1fs of %s; %d events, %d keepalive comments", res.heldFor.Seconds(), hold, res.events, res.comments)
		if res.wasDropped {
			detail = fmt.Sprintf("dropped after %.1fs of %s (%s); %d events, %d keepalive comments", res.heldFor.Seconds(), hold, res.lastError, res.events, res.comments)
		}
		c.note("stream-end", detail, !res.wasDropped)
		sc.rn.check("the event stream on "+path+" stays open for "+hold.String(), !res.wasDropped, detail)
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
	c.shouldReinitOn404 = false
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
	c.shouldReinitOn404 = false
	x, err := c.send(ctx, map[string]any{"jsonrpc": "2.0", "id": c.nextID.Add(1), "method": kindToolsList}, true)
	detail := fmt.Sprintf("answered %d", x.status)
	if x.status == http.StatusUnauthorized {
		detail += ": a spec client would start a new sign-in for a session that is merely gone"
	}
	sc.rn.check(what+" on "+c.path+" answers 404", errors.Is(err, errSessionLost) && x.status == http.StatusNotFound, detail)
	refreshes := c.refreshes + sc.s.grants.status().Refreshes
	c.shouldReinitOn404 = true
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

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}
