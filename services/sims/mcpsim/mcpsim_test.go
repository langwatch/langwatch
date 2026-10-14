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

// connectOAuth runs an automated connect with the fake's session cookie.
func connectOAuth(t *testing.T, sim string) RunStatus {
	t.Helper()
	code, st := call[RunStatus](t, http.MethodPost, sim+"/_sim/api/oauth/connect", ConnectRequest{Mode: "auto", Cookie: "better-auth.session_token=session-1", Wait: true})
	if code != http.StatusOK {
		t.Fatalf("connect answered %d", code)
	}
	return st
}

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
	}
}

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

func TestA503IsRetriedWithBackoff(t *testing.T) {
	f := newFakeLangWatch(t)
	f.set(func(f *fakeLangWatch) { f.fail503 = 2 })
	_, sim := simAt(t, f)
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Transport: "/mcp"})
	mustPass(t, st)
	if !hasStep(st, "initialize", 503) {
		t.Errorf("the 503 attempts are not recorded: %s", stepLine(st))
	}
}

func TestReconnectExpects404ThenReinitializesWithoutSigningIn(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioReconnect, Transport: "both"})
	mustPass(t, st)
	if len(st.Checks) != 8 {
		t.Errorf("%d checks: %+v", len(st.Checks), st.Checks)
	}
}

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

func TestIdleReinitializesSilentlyWhenTheSessionWasLost(t *testing.T) {
	f := newFakeLangWatch(t)
	s, sim := simAt(t, f)
	s.sleep = func(context.Context, time.Duration) bool { f.forgetSessions(); return true }
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioIdle, IdleSeconds: 3600})
	mustPass(t, st)
	if !hasStep(st, "tools/list", 404) || !hasStep(st, "initialize", 200) {
		t.Errorf("no 404 then re-initialize: %s", stepLine(st))
	}
}

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

	f.set(func(f *fakeLangWatch) { f.dropAfter = 0 })
	mustPass(t, runScenario(t, sim, RunRequest{Scenario: ScenarioStream, HoldSeconds: 1, Transport: "/sse"}))
}

func TestOAuthConnectWithASessionCookieThenRefreshKeepsTheSession(t *testing.T) {
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
	_, g := call[GrantStatus](t, http.MethodGet, sim+"/_sim/api/oauth", nil)
	if !g.Connected || g.ClientID == "" || strings.Contains(g.AccessHint, "access-") && len(g.AccessHint) > 12 {
		t.Errorf("grant %+v", g)
	}

	mustPass(t, runScenario(t, sim, RunRequest{Scenario: ScenarioRefresh, Flow: FlowOAuth}))
	mustPass(t, runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Flow: FlowOAuth}))
}

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
}

func TestDoubleRefreshPassesInsideTheRetryWindowAndFailsWithout(t *testing.T) {
	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	mustPass(t, connectOAuth(t, sim))
	mustPass(t, runScenario(t, sim, RunRequest{Scenario: ScenarioDoubleRefresh, Flow: FlowOAuth}))

	f.set(func(f *fakeLangWatch) { f.refreshCalm = false })
	st := runScenario(t, sim, RunRequest{Scenario: ScenarioDoubleRefresh, Flow: FlowOAuth})
	if st.State != StateFailed {
		t.Fatalf("a refused repeat refresh passed")
	}
	// The pair one refresh answered is kept, so the flow goes on working.
	mustPass(t, runScenario(t, sim, RunRequest{Scenario: ScenarioConnect, Flow: FlowOAuth, Transport: "/mcp"}))
}

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
}

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
}

func TestWellKnownInsertsTheSegmentBeforeTheIssuerPath(t *testing.T) {
	if got := wellKnown("https://a.test", "oauth-authorization-server"); got != "https://a.test/.well-known/oauth-authorization-server" {
		t.Error(got)
	}
	if got := wellKnown("https://a.test/tenant", "oauth-authorization-server"); got != "https://a.test/.well-known/oauth-authorization-server/tenant" {
		t.Error(got)
	}
}
