package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
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
