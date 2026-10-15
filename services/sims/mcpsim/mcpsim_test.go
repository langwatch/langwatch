package mcpsim

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

// simAt is a sim aimed at the fake, served on its own listener so the OAuth callback is reachable.
func simAt(t *testing.T, f *fakeLangWatch, change ...func(*Config)) (*Server, string) {
	t.Helper()
	cfg := Config{Endpoint: f.URL(), APIKey: f.apiKey, ProjectID: "local-dev-project", ApprovalTimeout: 5 * time.Second}
	for _, c := range change {
		c(&cfg)
	}
	s := NewServer(cfg)
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	t.Cleanup(s.stopAll)
	s.cfg.PublicURL = srv.URL
	return s, srv.URL
}

func call[T any](t *testing.T, method, target string, body any) (int, T) {
	t.Helper()
	var r *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, target, r)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("%s %s answered %d, not JSON: %v", method, target, resp.StatusCode, err)
	}
	return resp.StatusCode, v
}

func runScenario(t *testing.T, sim string, req RunRequest) RunStatus {
	t.Helper()
	req.Wait = true
	code, st := call[RunStatus](t, http.MethodPost, sim+"/_sim/api/runs", req)
	if code != http.StatusOK {
		t.Fatalf("starting %s answered %d: %+v", req.Scenario, code, st)
	}
	return st
}

func failedChecks(st RunStatus) []string {
	var out []string
	for i := range st.Checks {
		if c := &st.Checks[i]; !c.Pass {
			out = append(out, c.Name+": "+c.Detail)
		}
	}
	if st.Error != "" {
		out = append(out, "error: "+st.Error)
	}
	return out
}

func mustPass(t *testing.T, st RunStatus) {
	t.Helper()
	if st.State != StatePassed {
		t.Fatalf("%s %s ended %s: %v\nsteps: %s", st.Scenario, st.Flow, st.State, failedChecks(st), stepLine(st))
	}
}

func stepLine(st RunStatus) string {
	var b strings.Builder
	for i := range st.Steps {
		s := &st.Steps[i]
		b.WriteString("\n  " + s.Kind + " " + s.Transport + " " + s.Method + " " + strconv.Itoa(s.Status) + " " + s.Detail + " " + s.Error)
	}
	return b.String()
}

func hasStep(st RunStatus, kind string, status int) bool {
	for i := range st.Steps {
		if s := &st.Steps[i]; s.Kind == kind && s.Status == status {
			return true
		}
	}
	return false
}

// passedCheck reports whether st has a passing check whose name contains part.
func passedCheck(st RunStatus, part string) bool {
	for i := range st.Checks {
		if c := &st.Checks[i]; c.Pass && strings.Contains(c.Name, part) {
			return true
		}
	}
	return false
}

// connectOAuth runs an automated connect with the fake's session cookie.
func connectOAuth(t *testing.T, sim string) RunStatus {
	t.Helper()
	code, st := call[RunStatus](t, http.MethodPost, sim+"/_sim/api/oauth/connect", ConnectRequest{Mode: "auto", Cookie: "better-auth.session_token=session-1", Wait: true})
	if code != http.StatusOK {
		t.Fatalf("connect answered %d", code)
	}
	return st
}

// @scenario "A client connects with a project API key on /mcp and /sse"
func TestConnectWithAnAPIKeyOnMcpAndSse(t *testing.T) {
	for _, sse := range []bool{false, true} {
		f := newFakeLangWatch(t)
		f.set(func(f *fakeLangWatch) { f.sseBodies = sse })
		_, sim := simAt(t, f)
		st := runScenario(t, sim, RunRequest{Scenario: ScenarioConnect})
		mustPass(t, st)
		if len(st.Transports) != 2 || len(st.Checks) != 8 {
			t.Errorf("sse %t: transports %v, %d checks", sse, st.Transports, len(st.Checks))
		}
		for _, kind := range []string{"initialize", "notifications/initialized", "tools/list", "tools/call", "delete"} {
			if !hasStep(st, kind, 200) && !hasStep(st, kind, 202) {
				t.Errorf("sse %t: no answered %s step", sse, kind)
			}
		}
		for _, path := range []string{"/mcp", "/sse"} {
			for _, check := range []string{"initialize on " + path, "tools/list on " + path, "tools/call " + defaultTool + " on " + path, "DELETE on " + path} {
				if !passedCheck(st, check) {
					t.Errorf("sse %t: no passing check %q: %+v", sse, check, st.Checks)
				}
			}
		}
	}
}

// @scenario "A wrong API key fails the run with the challenge reported"
func TestABadAPIKeyFailsWithTheChallengeReported(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Transport: "/mcp", APIKey: "sk-lw-wrong-key-000000000"})
	if st.State != StateFailed || !hasStep(st, "initialize", 401) {
		t.Fatalf("state %s steps %s", st.State, stepLine(st))
	}
	if !strings.Contains(st.Steps[0].Detail, "resource_metadata") {
		t.Errorf("the 401 step does not report the challenge: %q", st.Steps[0].Detail)
	}
}

// @scenario "A 503 from the endpoint is retried with backoff"
func TestA503IsRetriedWithBackoff(t *testing.T) {
	f := newFakeLangWatch(t)
	f.set(func(f *fakeLangWatch) { f.fail503 = 2 })
	_, sim := simAt(t, f)
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Transport: "/mcp"})
	mustPass(t, st)
	retries := 0
	for _, s := range st.Steps {
		if s.Kind == "initialize" && s.Status == http.StatusServiceUnavailable {
			retries++
			if s.Detail != "retry in 0s" {
				t.Errorf("a 503 with Retry-After: 0 waits %q", s.Detail)
			}
		}
	}
	if retries != 2 {
		t.Errorf("%d 503 attempts recorded, want 2: %s", retries, stepLine(st))
	}

	// With no Retry-After the wait doubles from 250ms; a named one is respected.
	if a, b := backoff(exchange{}, 0), backoff(exchange{}, 1); a != 250*time.Millisecond || b != 500*time.Millisecond {
		t.Errorf("backoff %s then %s, want 250ms then 500ms", a, b)
	}
	if d := backoff(exchange{header: http.Header{"Retry-After": {"2"}}}, 0); d != 2*time.Second {
		t.Errorf("Retry-After: 2 waits %s", d)
	}
}

// @scenario "A lost session answers 404 and the client re-initializes without a new sign-in"
func TestReconnectExpects404ThenReinitializesWithoutSigningIn(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioReconnect, Transport: "both"})
	mustPass(t, st)
	if len(st.Checks) != 8 {
		t.Errorf("%d checks: %+v", len(st.Checks), st.Checks)
	}
	for _, path := range []string{"/mcp", "/sse"} {
		for _, what := range []string{"an unknown session id", "an ended session id"} {
			if !passedCheck(st, what+" on "+path+" answers 404") || !passedCheck(st, "after "+what+", re-initializing on "+path+" works without a new sign-in") {
				t.Errorf("%s on %s: checks %+v", what, path, st.Checks)
			}
		}
	}
}

// @scenario "A lost session answered with 401 is reported as a failure"
func TestReconnectReportsA401ForALostSession(t *testing.T) {
	f := newFakeLangWatch(t)
	f.set(func(f *fakeLangWatch) { f.lostStatus = http.StatusUnauthorized })
	_, sim := simAt(t, f)
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioReconnect})
	if st.State != StateFailed {
		t.Fatalf("a 401 for a lost session passed")
	}
	if fails := failedChecks(st); len(fails) == 0 || !strings.Contains(fails[0], "new sign-in") {
		t.Errorf("failures %v", fails)
	}
}

// @scenario "An idle client whose session was lost re-initializes silently"
func TestIdleReinitializesSilentlyWhenTheSessionWasLost(t *testing.T) {
	f := newFakeLangWatch(t)
	s, sim := simAt(t, f)
	s.sleep = func(context.Context, time.Duration) bool { f.forgetSessions(); return true }
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioIdle, IdleSeconds: 3600})
	mustPass(t, st)
	if !hasStep(st, "tools/list", 404) || !hasStep(st, "initialize", 200) {
		t.Errorf("no 404 then re-initialize: %s", stepLine(st))
	}
	if !passedCheck(st, "the session answers after 1h0m0s idle") {
		t.Errorf("checks %+v", st.Checks)
	}
}

// @scenario "The event stream is held, and a dropped one is reported"
func TestStreamReportsADroppedEventStream(t *testing.T) {
	f := newFakeLangWatch(t)
	f.set(func(f *fakeLangWatch) { f.dropAfter = 100 * time.Millisecond })
	_, sim := simAt(t, f)
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioStream, HoldSeconds: 1})
	if st.State != StateFailed {
		t.Fatalf("a dropped stream passed: %s", stepLine(st))
	}
	if fails := failedChecks(st); len(fails) != 1 || !strings.Contains(fails[0], "dropped after") {
		t.Errorf("failures %v", fails)
	}
	if !passedCheck(st, "the session on /mcp still answers after the stream") {
		t.Errorf("a dropped stream lost the session: %+v", st.Checks)
	}

	f.set(func(f *fakeLangWatch) { f.dropAfter = 0 })
	mustPass(t, runScenario(t, sim, RunRequest{Scenario: ScenarioStream, HoldSeconds: 1, Transport: "/sse"}))
}

// @scenario "An OAuth connect discovers, registers, gets approval and exchanges the code"
func TestOAuthConnectWithASessionCookie(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	st := connectOAuth(t, sim)
	mustPass(t, st)
	for _, kind := range []string{"challenge", "discover", "register", "approve", "token"} {
		found := false
		for _, s := range st.Steps {
			found = found || (s.Kind == kind && s.OK)
		}
		if !found {
			t.Errorf("no successful %s step: %s", kind, stepLine(st))
		}
	}
	if !passedCheck(st, "PKCE S256") || !passedCheck(st, "the new access token opens a session and lists tools") {
		t.Errorf("checks %+v", st.Checks)
	}
	_, g := call[GrantStatus](t, http.MethodGet, sim+"/_sim/api/oauth", nil)
	if !g.Connected || g.ClientID == "" || strings.Contains(g.AccessHint, "access-") && len(g.AccessHint) > 12 {
		t.Errorf("grant %+v", g)
	}

	mustPass(t, runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Flow: FlowOAuth}))
}

// @scenario "A refresh mid-session keeps the same session"
func TestRefreshKeepsTheSessionWithTheNewToken(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	mustPass(t, connectOAuth(t, sim))
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioRefresh, Flow: FlowOAuth})
	mustPass(t, st)
	if !passedCheck(st, "the refresh answers a new access token") || !passedCheck(st, "the same session id answers with the new token") {
		t.Errorf("checks %+v", st.Checks)
	}
	if _, g := call[GrantStatus](t, http.MethodGet, sim+"/_sim/api/oauth", nil); g.Refreshes != 1 {
		t.Errorf("the grant counts %d refreshes", g.Refreshes)
	}
}

// @scenario "The sim signs in itself with the configured local login"
func TestOAuthSignsInItselfWhenGivenTheLogin(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f, func(c *Config) { c.SignInEmail, c.SignInPassword = "admin@example.com", "pw" })
	_, status := call[Status](t, http.MethodGet, sim+"/_sim/api/status", nil)
	if status.AutoApprove != "sign-in admin@example.com" || status.KeyHint == f.apiKey {
		t.Errorf("status %+v", status)
	}
	code, st := call[RunStatus](t, http.MethodPost, sim+"/_sim/api/oauth/connect", ConnectRequest{Wait: true})
	if code != http.StatusOK {
		t.Fatalf("connect answered %d", code)
	}
	mustPass(t, st)
	if !hasStep(st, "sign-in", http.StatusOK) || f.timesAsked("POST /api/auth/sign-in/email") != 1 {
		t.Errorf("no sign-in before the approval: %s", stepLine(st))
	}
}

// @scenario "Two concurrent refreshes pass only inside the server's retry window"
func TestDoubleRefreshPassesInsideTheRetryWindowAndFailsWithout(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	mustPass(t, connectOAuth(t, sim))
	calm := runScenario(t, sim, RunRequest{Scenario: ScenarioDoubleRefresh, Flow: FlowOAuth})
	mustPass(t, calm)
	if !passedCheck(calm, "both answer the same new token pair") {
		t.Errorf("checks %+v", calm.Checks)
	}

	f.set(func(f *fakeLangWatch) { f.refreshCalm = false })
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioDoubleRefresh, Flow: FlowOAuth})
	if st.State != StateFailed {
		t.Fatalf("a refused repeat refresh passed")
	}
	if fails := failedChecks(st); len(fails) == 0 || !strings.Contains(fails[0], "already used") {
		t.Errorf("failures %v", fails)
	}
	// The pair one refresh answered is kept, so the flow goes on working.
	mustPass(t, runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Flow: FlowOAuth, Transport: "/mcp"}))
}

// @scenario "An expired access token is refreshed and the request retried"
func TestAnExpiredAccessTokenIsRefreshedAndTheRequestRetried(t *testing.T) {
	f := newFakeLangWatch(t)
	s, sim := simAt(t, f)
	mustPass(t, connectOAuth(t, sim))
	s.sleep = func(context.Context, time.Duration) bool { f.expireAccess(); return true }
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioIdle, Flow: FlowOAuth, IdleSeconds: 60})
	mustPass(t, st)
	if !hasStep(st, "tools/list", 401) || !hasStep(st, "refresh", 200) {
		t.Errorf("no 401 then refresh: %s", stepLine(st))
	}
}

// @scenario "An interactive OAuth connect waits for a person to approve in the browser"
func TestInteractiveConnectWaitsForTheBrowserCallback(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	code, st := call[RunStatus](t, http.MethodPost, sim+"/_sim/api/oauth/connect", ConnectRequest{Mode: "interactive"})
	if code != http.StatusAccepted || st.State != StateWaiting || st.AuthorizeURL == "" {
		t.Fatalf("connect answered %d %s %q", code, st.State, st.AuthorizeURL)
	}
	// The person approves on the consent page, which posts the approval and follows the redirect.
	au, _ := url.Parse(st.AuthorizeURL)
	q := au.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("redirect_uri") != sim+"/callback" || au.Path != "/mcp/authorize" {
		t.Fatalf("authorize URL %s", st.AuthorizeURL)
	}
	body, _ := json.Marshal(map[string]string{"projectId": "p", "client_id": q.Get("client_id"), "redirect_uri": q.Get("redirect_uri"),
		"code_challenge": q.Get("code_challenge"), "code_challenge_method": "S256", "state": q.Get("state")})
	req, _ := http.NewRequest(http.MethodPost, f.URL()+"/api/mcp/authorize", bytes.NewReader(body))
	req.AddCookie(&http.Cookie{Name: "better-auth.session_token", Value: "session-1"}) //nolint:gosec // G124: a request cookie in a plain-HTTP test
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var approved struct{ Redirect string }
	_ = json.NewDecoder(resp.Body).Decode(&approved)
	_ = resp.Body.Close()
	cb, err := http.Get(approved.Redirect)
	if err != nil || cb.StatusCode != http.StatusOK {
		t.Fatalf("callback %v %v", cb, err)
	}
	_ = cb.Body.Close()
	deadline := time.Now().Add(5 * time.Second)
	for st.State == StateWaiting || st.State == StateRunning {
		if time.Now().After(deadline) {
			t.Fatalf("still %s", st.State)
		}
		time.Sleep(20 * time.Millisecond)
		_, st = call[RunStatus](t, http.MethodGet, sim+"/_sim/api/runs/"+st.ID, nil)
	}
	mustPass(t, st)
}

// @scenario "A soak runs concurrent clients and counts what they did"
func TestSoakRunsConcurrentClientsAndCountsThem(t *testing.T) {
	f := newFakeLangWatch(t)
	f.set(func(f *fakeLangWatch) { f.fail503 = 1 })
	_, sim := simAt(t, f)
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioSoak, Clients: 4, Duration: "1500ms", Transport: "both"})
	mustPass(t, st)
	l := st.Load
	if l == nil || l.Clients != 4 || l.Sessions < 4 || l.Requests < 8 || l.Retried != 1 || l.Answers[200] == 0 || l.Latency == nil {
		t.Errorf("load %+v", l)
	}
}

// @scenario "A run request the sim cannot run is refused before it starts"
func TestRequestsAreCheckedBeforeARunStarts(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	for _, req := range []RunRequest{
		{Scenario: "nope"},
		{Scenario: ScenarioRefresh},                   // needs the oauth flow
		{Scenario: ScenarioConnect, Flow: FlowOAuth},  // no grant yet
		{Scenario: ScenarioConnect, Transport: "/ws"}, // no such transport
		{Scenario: ScenarioSoak, Clients: maxClients + 1},
		{Scenario: ScenarioConnect, Endpoint: "http://elsewhere.test"}, // the configured key never goes elsewhere
	} {
		code, ans := call[map[string]string](t, http.MethodPost, sim+"/_sim/api/runs", req)
		if code != http.StatusBadRequest || ans["error"] == "" {
			t.Errorf("%+v answered %d %v", req, code, ans)
		}
	}
	if _, list := call[map[string][]RunStatus](t, http.MethodGet, sim+"/_sim/api/runs", nil); len(list["runs"]) != 0 {
		t.Errorf("a refused request started %d runs", len(list["runs"]))
	}
}

// @scenario "Runs are listed newest first, bounded and cleared"
func TestRunsAreListedNewestFirstAndCleared(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	first := runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Transport: "/mcp"})
	second := runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Transport: "/sse"})
	_, list := call[map[string][]RunStatus](t, http.MethodGet, sim+"/_sim/api/runs", nil)
	if runs := list["runs"]; len(runs) != 2 || runs[0].ID != second.ID || runs[1].ID != first.ID || len(runs[0].Steps) != 0 {
		t.Errorf("runs %+v", runs)
	}
	_, latest := call[RunStatus](t, http.MethodGet, sim+"/_sim/api/runs/latest", nil)
	if latest.ID != second.ID || len(latest.Steps) == 0 {
		t.Errorf("latest %s with %d steps", latest.ID, len(latest.Steps))
	}
	_, cleared := call[map[string][]RunStatus](t, http.MethodDelete, sim+"/_sim/api/runs", nil)
	if len(cleared["runs"]) != 0 {
		t.Errorf("clear left %d runs", len(cleared["runs"]))
	}
}

// @scenario "Runs are listed newest first, bounded and cleared"
func TestStepsAreBounded(t *testing.T) {
	rn := &run{}
	for range maxSteps + 5 {
		rn.step(Step{Kind: "x"})
	}
	st := rn.snapshot(true)
	if len(st.Steps) != maxSteps || st.StepsDropped != 5 {
		t.Errorf("%d steps, %d dropped", len(st.Steps), st.StepsDropped)
	}
}

// @scenario "An answer in an SSE body is found among pings and other messages"
func TestReadSSEAnswerSkipsOtherMessages(t *testing.T) {
	body := ": ping\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\n" +
		"data: \"id\":7,\"result\":{\"ok\":true}}\n\n"
	m, err := readSSEAnswer(strings.NewReader(body), int64(7))
	if err != nil || string(m.Result) != `{"ok":true}` {
		t.Fatalf("%v %v", m, err)
	}
	if _, err := readSSEAnswer(strings.NewReader(": only a comment\n\n"), int64(7)); err == nil {
		t.Error("an answerless stream read as answered")
	}
	long := "data: " + strings.Repeat("x", maxSSEEvent) + "\n\n"
	if _, err := readSSEAnswer(strings.NewReader(long), int64(7)); err == nil || !strings.Contains(err.Error(), "longer than") {
		t.Errorf("a line past the limit read as %v", err)
	}
	unended := strings.Repeat("data: "+strings.Repeat("x", 1000)+"\n", maxSSEEvent/1000)
	if _, err := readSSEAnswer(strings.NewReader(unended), int64(7)); err == nil || !strings.Contains(err.Error(), "longer than") {
		t.Errorf("an event that never ends read as %v", err)
	}
	// Comments between data lines do not reset the open event's count.
	interleaved := strings.Repeat("data: "+strings.Repeat("x", 1000)+"\n: ping\n", maxSSEEvent/1000)
	if _, err := readSSEAnswer(strings.NewReader(interleaved), int64(7)); err == nil || !strings.Contains(err.Error(), "longer than") {
		t.Errorf("an event padded with comments read as %v", err)
	}
	// Blank lines with no event open never add up to an over-long event.
	blanks := strings.Repeat("\n", maxSSEEvent+10) + "data: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{}}\n\n"
	if m, err := readSSEAnswer(strings.NewReader(blanks), int64(7)); err != nil || m == nil {
		t.Errorf("an answer after many blank lines read as %v %v", m, err)
	}
}

// @scenario "Authorization-server metadata is looked up at the issuer's well-known address"
func TestWellKnownInsertsTheSegmentBeforeTheIssuerPath(t *testing.T) {
	if got := wellKnown("https://a.test", "oauth-authorization-server"); got != "https://a.test/.well-known/oauth-authorization-server" {
		t.Error(got)
	}
	if got := wellKnown("https://a.test/tenant", "oauth-authorization-server"); got != "https://a.test/.well-known/oauth-authorization-server/tenant" {
		t.Error(got)
	}
}

// @scenario "Held credentials only go to the endpoint they belong to"
func TestHeldCredentialsOnlyGoToTheirOwnEndpoint(t *testing.T) {
	t.Run("the configured API key", func(t *testing.T) {
		f, other := newFakeLangWatch(t), newFakeLangWatch(t)
		_, sim := simAt(t, f)
		code, ans := call[map[string]string](t, http.MethodPost, sim+"/_sim/api/runs", RunRequest{Scenario: ScenarioConnect, Endpoint: other.URL()})
		if code != http.StatusBadRequest || !strings.Contains(ans["error"], "needs a project API key") || other.credentialsSeen() != 0 {
			t.Errorf("an apikey run to another endpoint answered %d %v", code, ans)
		}
	})

	t.Run("the OAuth grant's token", func(t *testing.T) {
		f, other := newFakeLangWatch(t), newFakeLangWatch(t)
		_, sim := simAt(t, f)
		mustPass(t, connectOAuth(t, sim))
		code, ans := call[map[string]string](t, http.MethodPost, sim+"/_sim/api/runs",
			RunRequest{Scenario: ScenarioConnect, Flow: FlowOAuth, Endpoint: other.URL()})
		if code != http.StatusBadRequest || !strings.Contains(ans["error"], "only goes there") || other.credentialsSeen() != 0 {
			t.Errorf("an oauth run to another endpoint answered %d %v", code, ans)
		}
	})

	t.Run("the configured session cookie", func(t *testing.T) {
		f, other := newFakeLangWatch(t), newFakeLangWatch(t)
		_, sim := simAt(t, f, func(c *Config) { c.Cookie = "better-auth.session_token=session-1" })
		_, st := call[RunStatus](t, http.MethodPost, sim+"/_sim/api/oauth/connect", ConnectRequest{Mode: "auto", Endpoint: other.URL(), Wait: true})
		if st.State != StateFailed || other.credentialsSeen() != 0 {
			t.Errorf("the configured session was sent to another endpoint: %s %s", st.State, stepLine(st))
		}
	})

	t.Run("the configured login", func(t *testing.T) {
		f, other := newFakeLangWatch(t), newFakeLangWatch(t)
		_, sim := simAt(t, f, func(c *Config) { c.SignInEmail, c.SignInPassword = "admin@example.com", "pw" })
		_, st := call[RunStatus](t, http.MethodPost, sim+"/_sim/api/oauth/connect", ConnectRequest{Mode: "auto", Endpoint: other.URL(), Wait: true})
		if st.State != StateFailed || !strings.Contains(st.Error, "the configured login only goes to") {
			t.Errorf("connect to another endpoint ended %s: %q", st.State, st.Error)
		}
		if n := other.credentialsSeen(); n != 0 {
			t.Errorf("the configured login reached another endpoint %d times", n)
		}
		if other.timesAsked("POST /mcp") == 0 {
			t.Error("the connect never reached the other endpoint, so this proves nothing")
		}
	})
}

// @scenario "The control API takes JSON only"
func TestAPostThatIsNotJSONIsRefused(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	for _, path := range []string{"/_sim/api/runs", "/_sim/api/oauth/connect"} {
		resp, err := http.Post(sim+path, "text/plain", strings.NewReader(`{"scenario":"connect"}`))
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusUnsupportedMediaType {
			t.Errorf("a text/plain POST to %s answered %d", path, resp.StatusCode)
		}
	}
	if _, list := call[map[string][]RunStatus](t, http.MethodGet, sim+"/_sim/api/runs", nil); len(list["runs"]) != 0 {
		t.Errorf("a refused POST started %d runs", len(list["runs"]))
	}
}
