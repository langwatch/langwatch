package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/langwatch/langwatch/services/sims/mcpsim"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

const mcpUsage = "usage: haven sim mcp <status|list|get <id|latest>|connect|stream|refresh|double-refresh|reconnect|idle|soak|oauth|grant|forget|stop <id>|clear|console> [--flow apikey|oauth] [--transport /mcp|/sse|both] [--json]"

// mcpRunVerbs are the verbs that start one scenario and wait for its outcome.
var mcpRunVerbs = map[string]bool{
	mcpsim.ScenarioConnect: true, mcpsim.ScenarioStream: true, mcpsim.ScenarioRefresh: true,
	mcpsim.ScenarioDoubleRefresh: true, mcpsim.ScenarioReconnect: true, mcpsim.ScenarioIdle: true, mcpsim.ScenarioSoak: true,
}

// mcpPollInterval is how often oauth asks the sim whether the connect has ended.
var mcpPollInterval = time.Second

// mcpOpen opens the approval page in the OS browser; a test replaces it.
var mcpOpen = openInBrowser

// mcpSpec is `haven sim mcp`: mcpsim's MCP clients against this stack's hosted MCP endpoint.
func mcpSpec() commandSpec {
	return commandSpec{
		name:    "mcp",
		summary: "mcpsim's MCP clients against hosted MCP: status | list | get | connect | stream | refresh | double-refresh | reconnect | idle | soak | oauth | grant | forget | stop | clear | console",
		args:    "<status|list|get|connect|stream|refresh|double-refresh|reconnect|idle|soak|oauth|grant|forget|stop|clear|console> [id]",
		maxArgs: 2,
		flags: simFlags(
			flagSpec{long: "--flow", takesValue: true, value: "<apikey|oauth>", summary: "how a run authenticates (default apikey; refresh and double-refresh: oauth)"},
			flagSpec{long: "--transport", takesValue: true, value: "</mcp|/sse|both>", summary: "the MCP path (default /mcp; connect: both)"},
			flagSpec{long: "--client", takesValue: true, value: "<name>", summary: "claude-code, claude-desktop or cursor (default claude-code)"},
			flagSpec{long: "--hold", takesValue: true, value: "<seconds>", summary: "stream: how long to hold the event stream (default 60)"},
			flagSpec{long: "--idle", takesValue: true, value: "<seconds>", summary: "idle: how long to sleep before reusing the session (default 30)"},
			flagSpec{long: "--clients", takesValue: true, value: "<n>", summary: "soak: concurrent clients (default 10)"},
			flagSpec{long: "--duration", takesValue: true, value: "<dur>", summary: "soak: how long, e.g. 5m (default 1m)"},
			flagSpec{long: "--tool", takesValue: true, value: "<name>", summary: "the tool connect calls (default fetch_langwatch_docs)"},
			flagSpec{long: "--target", takesValue: true, value: "<url>", summary: "a LangWatch base URL instead of this stack's app"},
			flagSpec{long: "--mode", takesValue: true, value: "<auto|interactive>", summary: "oauth: the sim approves itself, or a person approves in the browser"},
			flagSpec{long: "--cookie", takesValue: true, value: "<cookie>", summary: "oauth: a LangWatch browser session to approve with (default $MCPSIM_COOKIE)"},
			flagSpec{long: "--project", takesValue: true, value: "<id>", summary: "oauth: the project the approval grants (default the seeded project)"},
			flagSpec{long: "--open", summary: "oauth: open the approval page in the browser"},
			flagSpec{long: "--timeout", takesValue: true, value: "<dur>", summary: "how long to wait for a run or an oauth connect to end (oauth default 5m)"},
			flagSpec{long: "--sim", takesValue: true, value: "<url>", summary: "an mcpsim haven does not run, e.g. http://127.0.0.1:5598"},
		),
		run: runMcp,
	}
}

// runMcp is `haven sim mcp <verb>`.
func runMcp(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(mcpUsage)
	}
	asJSON := inv.has("--json") || d.isAgent
	if inv.args[0] == "console" {
		return mcpConsole(d, inv, asJSON)
	}
	api, err := mcpAPI(d, inv)
	if err != nil {
		return err
	}
	return mcpCommand(api, inv, asJSON)
}

func mcpCommand(api sources.SimAPI, inv invocation, asJSON bool) error {
	verb := inv.args[0]
	if mcpRunVerbs[verb] {
		return mcpStartRun(api, inv, asJSON)
	}
	switch verb {
	case "status":
		return simGet(api, "/_sim/api/status", nil, asJSON, printMcpStatus)
	case "list":
		return simGet(api, "/_sim/api/runs", nil, asJSON, func(v mcpRuns) { printMcpRuns(v.Runs) })
	case "get":
		if err := needArgs(inv, 2, "haven sim mcp get <id|latest>"); err != nil {
			return err
		}
		return simGet(api, "/_sim/api/runs/"+url.PathEscape(inv.args[1]), nil, asJSON, func(st mcpsim.RunStatus) { printMcpRun(&st) })
	case "oauth":
		return mcpOAuth(api, inv, asJSON)
	case "grant":
		return simGet(api, "/_sim/api/oauth", nil, asJSON, printMcpGrant)
	}
	return mcpDelete(api, inv, asJSON)
}

// mcpStartRun runs one scenario verb to its end, under a timeout that covers it.
func mcpStartRun(api sources.SimAPI, inv invocation, asJSON bool) error {
	req, err := mcpRunRequest(inv.args[0], inv)
	if err != nil {
		return err
	}
	timeout, err := mcpRunTimeout(inv, req)
	if err != nil {
		return err
	}
	return mcpRun(api.WithTimeout(timeout), req, asJSON)
}

// mcpDelete is the verbs that remove: forget, stop and clear.
func mcpDelete(api sources.SimAPI, inv invocation, asJSON bool) error {
	switch inv.args[0] {
	case "forget":
		if err := api.Delete("/_sim/api/oauth"); err != nil {
			return err
		}
		return simDone(asJSON, "forgotten", "OAuth grant forgotten")
	case "stop":
		if err := needArgs(inv, 2, "haven sim mcp stop <id>"); err != nil {
			return err
		}
		if err := api.Delete("/_sim/api/runs/" + url.PathEscape(inv.args[1])); err != nil {
			return err
		}
		return simDone(asJSON, "stopped", "run "+inv.args[1]+" stopped")
	case "clear":
		if err := api.Delete("/_sim/api/runs"); err != nil {
			return err
		}
		return simDone(asJSON, "cleared", "runs cleared")
	}
	return fmt.Errorf("unknown `haven sim mcp` subcommand %q; %s", inv.args[0], mcpUsage)
}

type mcpRuns struct {
	Runs []mcpsim.RunStatus `json:"runs"`
}

// mcpRunRequest maps the flags onto one scenario the sim runs to its end.
func mcpRunRequest(verb string, inv invocation) (mcpsim.RunRequest, error) {
	req := mcpsim.RunRequest{
		Scenario: verb, Client: inv.value("--client"),
		Duration: inv.value("--duration"), Tool: inv.value("--tool"), Endpoint: inv.value("--target"), Wait: true,
	}
	var err error
	if req.Flow, err = mcpFlow(verb, inv.value("--flow")); err != nil {
		return req, err
	}
	if req.Transport, err = mcpTransport(verb, inv.value("--transport")); err != nil {
		return req, err
	}
	if err := mcpNumbers(inv, &req); err != nil {
		return req, err
	}
	if req.Duration != "" {
		if _, err := time.ParseDuration(req.Duration); err != nil {
			return req, fmt.Errorf("--duration %q is not a duration, e.g. 5m", req.Duration)
		}
	}
	return req, nil
}

// mcpFlow is --flow, else apikey (oauth for the refresh scenarios, which need a grant).
func mcpFlow(verb, flow string) (string, error) {
	switch {
	case flow == "" && (verb == mcpsim.ScenarioRefresh || verb == mcpsim.ScenarioDoubleRefresh):
		return mcpsim.FlowOAuth, nil
	case flow == "":
		return mcpsim.FlowAPIKey, nil
	case flow == mcpsim.FlowAPIKey || flow == mcpsim.FlowOAuth:
		return flow, nil
	}
	return flow, fmt.Errorf("--flow %q: use apikey or oauth", flow)
}

// mcpTransport is --transport, else both for connect and the sim's default otherwise.
func mcpTransport(verb, transport string) (string, error) {
	switch transport {
	case "":
		if verb == mcpsim.ScenarioConnect {
			return "both", nil
		}
		return "", nil
	case "/mcp", "/sse", "both":
		return transport, nil
	case "mcp", "sse":
		return "/" + transport, nil
	}
	return transport, fmt.Errorf("--transport %q: use /mcp, /sse or both", transport)
}

// mcpNumbers reads the whole-number flags into req; an absent flag keeps the sim's default.
func mcpNumbers(inv invocation, req *mcpsim.RunRequest) error {
	for flag, into := range map[string]*int{"--hold": &req.HoldSeconds, "--idle": &req.IdleSeconds, "--clients": &req.Clients} {
		n, err := intFlag(inv, flag, 0)
		if err != nil {
			return err
		}
		*into = n
	}
	return nil
}

// mcpRunTimeout bounds a waited run: --timeout, else the scenario's own length
// (its hold, idle or soak duration, at their defaults when unset) plus slack.
func mcpRunTimeout(inv invocation, req mcpsim.RunRequest) (time.Duration, error) {
	if raw := inv.value("--timeout"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			return 0, fmt.Errorf("--timeout %q is not a duration, e.g. 10m", raw)
		}
		return d, nil
	}
	length := time.Duration(0)
	switch req.Scenario {
	case mcpsim.ScenarioStream:
		length = secondsOr(req.HoldSeconds, 60)
	case mcpsim.ScenarioIdle:
		length = secondsOr(req.IdleSeconds, 30)
	case mcpsim.ScenarioSoak:
		length = time.Minute
		if d, err := time.ParseDuration(req.Duration); err == nil && d > 0 {
			length = d
		}
	}
	return length + 2*time.Minute, nil
}

func secondsOr(n, fallback int) time.Duration {
	if n <= 0 {
		n = fallback
	}
	return time.Duration(n) * time.Second
}

// mcpRun starts one scenario, waits for it, prints it and fails unless it passed.
func mcpRun(api sources.SimAPI, req mcpsim.RunRequest, asJSON bool) error {
	var raw json.RawMessage
	if err := api.Post("/_sim/api/runs", req, &raw); err != nil {
		return err
	}
	return mcpOutcome(raw, asJSON)
}

// mcpOutcome prints a finished run (raw with --json) and returns an error unless it passed.
func mcpOutcome(raw json.RawMessage, asJSON bool) error {
	var st mcpsim.RunStatus
	if err := json.Unmarshal(raw, &st); err != nil {
		return err
	}
	if asJSON {
		if err := printSimRaw(raw); err != nil {
			return err
		}
	} else {
		printMcpRun(&st)
	}
	if st.State != mcpsim.StatePassed {
		reason := st.State
		if st.Error != "" {
			reason += ": " + st.Error
		}
		return fmt.Errorf("mcp %s run %s %s", st.Scenario, st.ID, reason)
	}
	return nil
}

// mcpOAuth starts the OAuth connect, shows the approval page when a person must
// approve, then follows the run until it ends.
func mcpOAuth(api sources.SimAPI, inv invocation, asJSON bool) error {
	timeout, err := mcpDuration(inv, 5*time.Minute)
	if err != nil {
		return err
	}
	req, err := mcpConnectRequest(inv)
	if err != nil {
		return err
	}
	var raw json.RawMessage
	if err := api.Post("/_sim/api/oauth/connect", req, &raw); err != nil {
		return err
	}
	raw, err = mcpFollow(api, raw, mcpWait{timeout: timeout, authorize: func(authorize string) { mcpShowAuthorize(authorize, inv.has("--open"), asJSON) }})
	if err != nil {
		return err
	}
	return mcpOutcome(raw, asJSON)
}

// mcpDuration is --timeout, else fallback.
func mcpDuration(inv invocation, fallback time.Duration) (time.Duration, error) {
	raw := inv.value("--timeout")
	if raw == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("--timeout %q is not a duration, e.g. 5m", raw)
	}
	return d, nil
}

// mcpConnectRequest maps the flags onto the OAuth connect; the cookie falls back to $MCPSIM_COOKIE.
func mcpConnectRequest(inv invocation) (mcpsim.ConnectRequest, error) {
	mode := inv.value("--mode")
	if mode != "" && mode != "auto" && mode != "interactive" {
		return mcpsim.ConnectRequest{}, fmt.Errorf("--mode %q: use auto or interactive", mode)
	}
	cookie := inv.value("--cookie")
	if cookie == "" {
		cookie = os.Getenv("MCPSIM_COOKIE")
	}
	return mcpsim.ConnectRequest{
		Mode: mode, Cookie: cookie, ProjectID: inv.value("--project"), Endpoint: inv.value("--target"), Client: inv.value("--client"),
	}, nil
}

// mcpWait is how long mcpFollow follows a run, and what it calls with the
// approval page the first time the run waits for one.
type mcpWait struct {
	timeout   time.Duration
	authorize func(string)
}

// mcpFollow polls a run until it is no longer running or waiting.
func mcpFollow(api sources.SimAPI, raw json.RawMessage, wait mcpWait) (json.RawMessage, error) {
	st, err := mcpDecodeRun(raw)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(wait.timeout)
	shown := false
	for st.State == mcpsim.StateRunning || st.State == mcpsim.StateWaiting {
		if st.State == mcpsim.StateWaiting && st.AuthorizeURL != "" && !shown {
			shown = true
			wait.authorize(st.AuthorizeURL)
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("mcp oauth-connect %s still %s after %s; approve at %s or raise --timeout", st.ID, st.State, wait.timeout, st.AuthorizeURL)
		}
		time.Sleep(mcpPollInterval)
		if raw, st, err = mcpPoll(api, st.ID); err != nil {
			return nil, err
		}
	}
	return raw, nil
}

// mcpPoll reads one run again.
func mcpPoll(api sources.SimAPI, id string) (json.RawMessage, mcpsim.RunStatus, error) {
	var raw json.RawMessage
	if err := api.Get("/_sim/api/runs/"+url.PathEscape(id), nil, &raw); err != nil {
		return nil, mcpsim.RunStatus{}, err
	}
	st, err := mcpDecodeRun(raw)
	return raw, st, err
}

func mcpDecodeRun(raw json.RawMessage) (mcpsim.RunStatus, error) {
	var st mcpsim.RunStatus
	err := json.Unmarshal(raw, &st)
	return st, err
}

// mcpShowAuthorize names the approval page on stderr, so --json keeps stdout one document.
func mcpShowAuthorize(authorize string, open, asJSON bool) {
	out := os.Stdout
	if asJSON {
		out = os.Stderr
	}
	_, _ = fmt.Fprintf(out, "approve the connect in the browser: %s\n", authorize)
	if open {
		if err := mcpOpen(authorize); err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "could not open the browser: %v\n", err)
		}
	}
}

func mcpAPI(d deps, inv invocation) (sources.SimAPI, error) {
	if sim := inv.value("--sim"); sim != "" {
		return sources.NewSimAPIAt(sim), nil
	}
	return simAPI(d, inv, "mcp")
}

// mcpConsole prints the console's URL: --sim's, or the stack's mcp route.
func mcpConsole(d deps, inv invocation, asJSON bool) error {
	console := inv.value("--sim")
	if console == "" {
		var err error
		if console, err = mcpRoute(d, inv); err != nil {
			return err
		}
	}
	if asJSON {
		return printMailJSON(map[string]string{"console": console})
	}
	fmt.Println(console)
	return nil
}

// mcpRoute is the stack's routed mcp console, or how to start it.
func mcpRoute(d deps, inv invocation) (string, error) {
	slug, err := tabSlug(d, inv)
	if err != nil {
		return "", err
	}
	for _, service := range d.orch.SessionSnapshot(slug).Services {
		if service.Name == "mcp" && service.Up {
			return service.URL, nil
		}
	}
	return "", fmt.Errorf("mcp is not running in %s; start it with haven up +mcp", slug)
}

func printMcpStatus(v mcpsim.Status) {
	fmt.Printf("stack %s -> %s (key %s from %s, project %s)\n", v.Stack, v.Endpoint, v.KeyHint, v.KeySource, v.ProjectID)
	fmt.Printf("oauth callback %s", v.CallbackURL)
	if v.AutoApprove != "" {
		fmt.Printf(", auto-approve with %s", v.AutoApprove)
	}
	fmt.Println()
	printMcpGrant(v.OAuth)
	printMcpRuns(v.Runs)
}

func printMcpGrant(g mcpsim.GrantStatus) {
	if !g.Connected {
		fmt.Println("oauth: not connected (haven sim mcp oauth)")
		return
	}
	fmt.Printf("oauth: connected to %s as client %s for project %s (access %s, refresh %s, %d refreshes)", g.Endpoint, g.ClientID, g.ProjectID, g.AccessHint, g.RefreshHint, g.Refreshes)
	if g.ExpiresAt != nil {
		fmt.Printf(", expires %s", g.ExpiresAt.Format(time.RFC3339))
	}
	fmt.Println()
}

func printMcpRuns(runs []mcpsim.RunStatus) {
	if len(runs) == 0 {
		fmt.Println("no runs yet")
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tSCENARIO\tFLOW\tCLIENT\tTRANSPORTS\tSTATE\tDURATION")
	for i := range runs {
		r := &runs[i]
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", r.ID, r.Scenario, r.Flow, r.Client, strings.Join(r.Transports, ","), r.State, mcpMillis(r.DurationMs))
	}
	_ = w.Flush()
}

// printMcpRun is one run: its steps, its checks, then its outcome.
func printMcpRun(st *mcpsim.RunStatus) {
	fmt.Printf("%s: %s, flow %s, client %s -> %s %s\n", st.ID, st.Scenario, st.Flow, st.Client, st.Endpoint, strings.Join(st.Transports, ","))
	printMcpSteps(st.Steps)
	if st.StepsDropped > 0 {
		fmt.Printf("  (%d older steps dropped)\n", st.StepsDropped)
	}
	printMcpChecks(st.Checks)
	printMcpLoad(st.Load)
	if st.AuthorizeURL != "" && st.State == mcpsim.StateWaiting {
		fmt.Printf("approve at %s\n", st.AuthorizeURL)
	}
	if st.Error != "" {
		fmt.Printf("error: %s\n", st.Error)
	}
	fmt.Printf("%s in %s\n", strings.ToUpper(st.State), mcpMillis(st.DurationMs))
}

func printMcpSteps(steps []mcpsim.Step) {
	if len(steps) == 0 {
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "  STEP\tTRANSPORT\tMETHOD\tSTATUS\tMS\tOK\tDETAIL")
	for i := range steps {
		s := &steps[i]
		fmt.Fprintf(w, "  %s\t%s\t%s\t%s\t%.0f\t%t\t%s\n", s.Kind, mcpDash(s.Transport), mcpDash(s.Method), mcpStatus(s.Status), s.LatencyMs, s.OK, mcpStepDetail(s))
	}
	_ = w.Flush()
}

func mcpStepDetail(s *mcpsim.Step) string {
	if s.Error == "" {
		return s.Detail
	}
	return strings.TrimSpace(s.Detail + " error: " + s.Error)
}

func mcpStatus(status int) string {
	if status == 0 {
		return "-"
	}
	return fmt.Sprint(status)
}

func printMcpChecks(checks []mcpsim.Check) {
	for _, c := range checks {
		mark := "PASS"
		if !c.Pass {
			mark = "FAIL"
		}
		line := "  " + mark + " " + c.Name
		if c.Detail != "" {
			line += ": " + c.Detail
		}
		fmt.Println(line)
	}
}

func printMcpLoad(l *mcpsim.LoadStats) {
	if l == nil {
		return
	}
	fmt.Printf("load: %d clients, %d sessions, %d requests, %d errors, %d re-initialized, %d refreshed, %d retried\n",
		l.Clients, l.Sessions, l.Requests, l.Errors, l.Reinitialized, l.Refreshed, l.Retried)
	if l.Latency != nil {
		fmt.Printf("latency ms over %d: p50 %.0f  p90 %.0f  p99 %.0f  max %.0f\n", l.Latency.Samples, l.Latency.P50, l.Latency.P90, l.Latency.P99, l.Latency.Max)
	}
}

func mcpMillis(ms float64) string {
	return (time.Duration(ms) * time.Millisecond).Round(time.Millisecond).String()
}

func mcpDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
