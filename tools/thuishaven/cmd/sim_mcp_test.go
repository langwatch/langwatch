package cmd

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/sims/mcpsim"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// fakeMcpsim answers POST /_sim/api/runs with state and records the request it got.
func fakeMcpsim(t *testing.T, state string) (sources.SimAPI, *mcpsim.RunRequest) {
	t.Helper()
	var got mcpsim.RunRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/_sim/api/runs" {
			http.Error(w, "no such route", http.StatusNotFound)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_ = json.NewEncoder(w).Encode(mcpsim.RunStatus{
			ID: "run-1", Scenario: got.Scenario, Flow: got.Flow, State: state, Transports: []string{"/mcp", "/sse"},
			Steps:  []mcpsim.Step{{Kind: "initialize", Transport: "/mcp", Method: "POST", Status: 200, LatencyMs: 12, OK: true}},
			Checks: []mcpsim.Check{{Name: "tools/list answers", Pass: state == mcpsim.StatePassed, Detail: "x"}},
		})
	}))
	t.Cleanup(srv.Close)
	return sources.NewSimAPIAt(srv.URL), &got
}

// @scenario "An agent runs a scenario from the terminal and its exit code says whether it passed"
func TestMcpRunVerbsWaitAndExitNonZeroUnlessPassed(t *testing.T) {
	api, got := fakeMcpsim(t, mcpsim.StatePassed)
	if err := mcpCommand(api, simInv("connect"), false); err != nil {
		t.Fatalf("a passed run failed the verb: %v", err)
	}
	if got.Scenario != "connect" || got.Flow != mcpsim.FlowAPIKey || got.Transport != "both" || !got.Wait {
		t.Errorf("connect sent %+v, want apikey on both transports with wait", *got)
	}

	failed, _ := fakeMcpsim(t, mcpsim.StateFailed)
	for _, asJSON := range []bool{false, true} {
		err := mcpCommand(failed, simInv("connect"), asJSON)
		if err == nil || !strings.Contains(err.Error(), "failed") {
			t.Errorf("json %t: a failed run must exit non-zero, got %v", asJSON, err)
		}
	}

	inv := invocation{flags: map[string]string{"--hold": "120", "--transport": "/sse", "--client": "cursor"}, args: []string{"stream"}}
	if err := mcpCommand(api, inv, false); err != nil {
		t.Fatal(err)
	}
	if got.Scenario != "stream" || got.HoldSeconds != 120 || got.Transport != "/sse" || got.Client != "cursor" {
		t.Errorf("stream sent %+v", *got)
	}
	if err := mcpCommand(api, simInv("refresh"), false); err != nil || got.Flow != mcpsim.FlowOAuth {
		t.Errorf("refresh: flow %q, %v; want oauth by default", got.Flow, err)
	}
	if err := mcpCommand(api, invocation{flags: map[string]string{"--flow": "nope"}, args: []string{"connect"}}, false); err == nil {
		t.Error("an unknown --flow must fail")
	}
}

// @scenario "An agent runs a scenario from the terminal and its exit code says whether it passed"
func TestMcpRunTimeoutCoversTheScenario(t *testing.T) {
	soak, _ := mcpRunRequest("soak", invocation{flags: map[string]string{"--duration": "5m", "--clients": "20"}})
	if d, _ := mcpRunTimeout(simInv("soak"), soak); d < 5*time.Minute {
		t.Errorf("soak 5m bounded at %s", d)
	}
	if d, _ := mcpRunTimeout(invocation{flags: map[string]string{"--timeout": "30s"}}, soak); d != 30*time.Second {
		t.Errorf("--timeout gave %s", d)
	}
	if _, err := mcpRunRequest("soak", invocation{flags: map[string]string{"--duration": "five"}}); err == nil {
		t.Error("a bad --duration must fail")
	}
}

// @scenario "An agent connects OAuth from the terminal"
func TestMcpOAuthPollsUntilTheConnectEnds(t *testing.T) {
	var polls atomic.Int32
	var connect mcpsim.ConnectRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /_sim/api/oauth/connect":
			_ = json.NewDecoder(r.Body).Decode(&connect)
			_ = json.NewEncoder(w).Encode(mcpsim.RunStatus{ID: "oc-1", Scenario: mcpsim.ScenarioOAuthConnect, State: mcpsim.StateWaiting, AuthorizeURL: "https://app.s.langwatch.localhost/mcp/authorize?x=1"})
		case "GET /_sim/api/runs/oc-1":
			state := mcpsim.StateWaiting
			if polls.Add(1) >= 2 {
				state = mcpsim.StatePassed
			}
			_ = json.NewEncoder(w).Encode(mcpsim.RunStatus{ID: "oc-1", Scenario: mcpsim.ScenarioOAuthConnect, State: state})
		default:
			http.Error(w, "no such route", http.StatusNotFound)
		}
	}))
	defer srv.Close()
	oldPoll, oldOpen := mcpPollInterval, mcpOpen
	defer func() { mcpPollInterval, mcpOpen = oldPoll, oldOpen }()
	mcpPollInterval = time.Millisecond
	var opened string
	mcpOpen = func(u string) error { opened = u; return nil }

	t.Setenv("MCPSIM_COOKIE", "better-auth.session_token=abc")
	inv := invocation{flags: map[string]string{"--mode": "interactive", "--open": ""}, args: []string{"oauth"}}
	if err := mcpCommand(sources.NewSimAPIAt(srv.URL), inv, false); err != nil {
		t.Fatalf("oauth: %v", err)
	}
	if !strings.Contains(opened, "/mcp/authorize") || polls.Load() < 2 {
		t.Errorf("opened %q after %d polls", opened, polls.Load())
	}
	if connect.Mode != "interactive" || connect.Cookie != "better-auth.session_token=abc" || connect.Wait {
		t.Errorf("connect sent %+v", connect)
	}
}

// @scenario "An agent reads and manages runs from the terminal"
func TestMcpReadVerbsDriveTheSimsAPI(t *testing.T) {
	api, seen := stubSim(t, map[string]string{
		"GET /_sim/api/status":        `{"stack":"s","callbackUrl":"https://mcp.s.langwatch.localhost/callback","oauth":{"connected":false},"runs":[]}`,
		"GET /_sim/api/runs":          `{"runs":[{"id":"run-1","scenario":"connect","state":"passed"}]}`,
		"GET /_sim/api/runs/latest":   `{"id":"run-1","scenario":"connect","state":"failed"}`,
		"GET /_sim/api/oauth":         `{"connected":true,"clientId":"c","refreshes":1}`,
		"DELETE /_sim/api/oauth":      ``,
		"DELETE /_sim/api/runs/run-1": ``,
		"DELETE /_sim/api/runs":       ``,
	})
	for _, args := range [][]string{{"status"}, {"list"}, {"get", "latest"}, {"grant"}, {"forget"}, {"stop", "run-1"}, {"clear"}} {
		if err := mcpCommand(api, simInv(args...), false); err != nil {
			t.Errorf("%v: %v", args, err)
		}
	}
	if len(*seen) != 7 {
		t.Errorf("calls %v", *seen)
	}
	if err := mcpCommand(api, simInv("stop"), false); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Errorf("stop without an id: %v", err)
	}
	if err := mcpCommand(api, simInv("nope"), false); err == nil {
		t.Error("an unknown verb must fail")
	}
	if err := mcpConsole(deps{}, invocation{flags: map[string]string{"--sim": "http://127.0.0.1:5598"}}, true); err != nil {
		t.Errorf("console with --sim: %v", err)
	}
}
