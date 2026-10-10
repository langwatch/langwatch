package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/services/telemetrysim"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

const telemetryUsage = "usage: haven sim telemetry <send|load|fuzz|post|status|list|get <id>|fixtures|fixture <name>|stop|console> [--preset <name>] [--seed <n>] [--json]"

// telemetrySpec is `haven sim telemetry`: telemetrysim's sends at this stack's OTLP door.
func telemetrySpec() commandSpec {
	return commandSpec{
		name:    "telemetry",
		summary: "telemetrysim's seeded OTLP sends at this stack: send | load | fuzz | post | status | runs | run | fixtures | fixture | stop | console",
		args:    "<send|load|fuzz|post|status|runs|run|fixtures|fixture|stop|console> [id|name]",
		maxArgs: 2,
		flags: simFlags(
			flagSpec{long: "--preset", takesValue: true, value: "<name>", summary: "llm-trace, claude-code-session, codex-session, logs or metrics (default llm-trace)"},
			flagSpec{long: "--seed", takesValue: true, value: "<n>", summary: "the seed every id and value derives from (default 1)"},
			flagSpec{long: "--batches", takesValue: true, value: "<n>", summary: "send: how many batches (default 1)"},
			flagSpec{long: "--rate", takesValue: true, value: "<n>", summary: "load: batches per second"},
			flagSpec{long: "--duration", takesValue: true, value: "<dur>", summary: "load: how long, e.g. 30s"},
			flagSpec{long: "--budget", takesValue: true, value: "<n>", summary: "fuzz: how many mutated batches (default 100)"},
			flagSpec{long: "--encoding", takesValue: true, value: "<protobuf|json>", summary: "OTLP HTTP body format (default protobuf)"},
			flagSpec{long: "--no-gzip", summary: "send bodies uncompressed"},
			flagSpec{long: "--fixture", takesValue: true, value: "<family/name>", summary: "post: a recorded fixture instead of a preset"},
			flagSpec{long: "--body-file", takesValue: true, value: "<path>", summary: "post: an OTLP JSON export request from a file"},
			flagSpec{long: "--target", takesValue: true, value: "<url>", summary: "an OTLP HTTP base to send to instead of this stack's /api/otel"},
			flagSpec{long: "--sim", takesValue: true, value: "<url>", summary: "a telemetrysim haven does not run, e.g. http://127.0.0.1:5599"},
		),
		run: runTelemetry,
	}
}

// runTelemetry is `haven sim telemetry <verb>`.
func runTelemetry(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(telemetryUsage)
	}
	asJSON := inv.has("--json") || d.isAgent
	if inv.args[0] == "console" {
		return telemetryConsole(d, inv, asJSON)
	}
	api, err := telemetryAPI(d, inv)
	if err != nil {
		return err
	}
	switch verb := inv.args[0]; verb {
	case "send", "load", "fuzz":
		req, err := telemetryRequest(verb, inv, telemetryOverlay(d, inv))
		if err != nil {
			return err
		}
		return startTelemetryRun(api, req, asJSON)
	case "post":
		req, err := telemetryPostRequest(inv, telemetryOverlay(d, inv))
		if err != nil {
			return err
		}
		return telemetryPost(api, req, asJSON)
	}
	return telemetryRead(api, inv, asJSON)
}

// telemetryRead is the verbs that read or stop: status, runs, run, fixtures, fixture, stop.
func telemetryRead(api sources.SimAPI, inv invocation, asJSON bool) error {
	switch inv.args[0] {
	case "status":
		return simGet(api, "/_sim/api/status", nil, asJSON, printTelemetryStatus)
	case "runs":
		return simGet(api, "/_sim/api/runs", nil, asJSON, printTelemetryRuns)
	case "run":
		if err := needArgs(inv, 2, "haven sim telemetry get <id|current>"); err != nil {
			return err
		}
		return simGet(api, "/_sim/api/runs/"+url.PathEscape(inv.args[1]), nil, asJSON, func(st telemetrysim.RunStatus) { printTelemetryRun(&st) })
	case "fixtures":
		return simGet(api, "/_sim/api/fixtures", nil, asJSON, printTelemetryFixtures)
	case "fixture":
		if err := needArgs(inv, 2, "haven sim telemetry fixture <name> [--seed <n>]"); err != nil {
			return err
		}
		return simGet(api, "/_sim/api/fixtures/"+inv.args[1], telemetrySeedQuery(inv), true, func(json.RawMessage) {})
	case "stop":
		if err := api.Delete("/_sim/api/runs/current"); err != nil {
			return err
		}
		return simDone(asJSON, "stopped", "run stopped")
	}
	return fmt.Errorf("unknown `haven sim telemetry` subcommand %q; %s", inv.args[0], telemetryUsage)
}

func telemetryRoute(d deps, inv invocation) (string, error) {
	slug, err := tabSlug(d, inv)
	if err != nil {
		return "", err
	}
	for _, service := range d.orch.SessionSnapshot(slug).Services {
		if service.Name == "telemetry" && service.Up {
			return service.URL, nil
		}
	}
	return "", fmt.Errorf("telemetry is not running in %s; start it with haven up +telemetry", slug)
}

func telemetrySeedQuery(inv invocation) url.Values {
	if seed := inv.value("--seed"); seed != "" {
		return url.Values{"seed": {seed}}
	}
	return nil
}

// telemetryConsole prints the console's URL: --sim's, or the stack's telemetry route.
func telemetryConsole(d deps, inv invocation, asJSON bool) error {
	console := inv.value("--sim")
	if console == "" {
		var err error
		if console, err = telemetryRoute(d, inv); err != nil {
			return err
		}
	}
	if asJSON {
		return printMailJSON(map[string]string{"console": console})
	}
	fmt.Println(console)
	return nil
}

func startTelemetryRun(api sources.SimAPI, req telemetrysim.RunRequest, asJSON bool) error {
	var raw json.RawMessage
	if err := api.Post("/_sim/api/runs", req, &raw); err != nil {
		return err
	}
	if asJSON {
		return printSimRaw(raw)
	}
	var st telemetrysim.RunStatus
	if err := json.Unmarshal(raw, &st); err != nil {
		return err
	}
	printTelemetryRun(&st)
	return nil
}

func telemetryAPI(d deps, inv invocation) (sources.SimAPI, error) {
	if sim := inv.value("--sim"); sim != "" {
		return sources.NewSimAPIAt(sim), nil
	}
	return simAPI(d, inv, "telemetry")
}

// telemetryOverlay is the stack's overlay env: its app URL and project key.
func telemetryOverlay(d deps, inv invocation) []string {
	if d.orch == nil {
		return nil
	}
	params := d.params
	if slug := inv.value("--stack"); slug != "" {
		params.ExplicitSlug = slug
	}
	env, err := d.orch.StackEnv(params)
	if err != nil {
		return nil
	}
	return env
}

func telemetryOverlayValue(overlay []string, key string) string {
	for _, kv := range overlay {
		if value, ok := strings.CutPrefix(kv, key+"="); ok {
			return value
		}
	}
	return ""
}

// telemetryRequest maps the flags onto a run aimed at the stack's OTLP door
// with its seeded project key; the key travels to the sim, never to stdout.
func telemetryRequest(verb string, inv invocation, overlay []string) (telemetrysim.RunRequest, error) {
	req := telemetrysim.RunRequest{
		Mode: verb, Preset: inv.value("--preset"), Seed: 1, Encoding: telemetrysim.Encoding(inv.value("--encoding")),
		NoGzip: inv.has("--no-gzip"), Duration: inv.value("--duration"),
	}
	if req.Preset == "" {
		req.Preset = "llm-trace"
	}
	if err := telemetryNumbers(inv, &req); err != nil {
		return req, err
	}
	var err error
	req.Endpoint, req.APIKey, err = telemetryTarget(inv, overlay)
	return req, err
}

// telemetryTarget is --target, else the stack's OTLP door with its seeded key.
func telemetryTarget(inv invocation, overlay []string) (string, string, error) {
	key := telemetryOverlayValue(overlay, "HAVEN_SEED_LANGWATCH_API_KEY")
	if target := inv.value("--target"); target != "" {
		return target, key, nil
	}
	app := telemetryOverlayValue(overlay, "LANGWATCH_ENDPOINT")
	if app == "" || key == "" {
		return "", "", errors.New("this worktree has no stack with a seeded project key; run haven up, or pass --target")
	}
	return strings.TrimRight(app, "/") + "/api/otel", key, nil
}

// telemetryNumbers reads the numeric flags into req; an absent flag keeps its default.
func telemetryNumbers(inv invocation, req *telemetrysim.RunRequest) error {
	for flag, into := range map[string]*int{"--batches": &req.Batches, "--budget": &req.Budget} {
		if raw := inv.value(flag); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				return fmt.Errorf("%s %q is not a whole number", flag, raw)
			}
			*into = n
		}
	}
	return telemetrySeedAndRate(inv, req)
}

func telemetrySeedAndRate(inv invocation, req *telemetrysim.RunRequest) error {
	if raw := inv.value("--seed"); raw != "" {
		seed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return fmt.Errorf("--seed %q is not a whole number", raw)
		}
		req.Seed = seed
	}
	if raw := inv.value("--rate"); raw != "" {
		rate, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return fmt.Errorf("--rate %q is not a number", raw)
		}
		req.Rate = rate
	}
	return nil
}

func printTelemetryStatus(v telemetrysim.Status) {
	fmt.Printf("stack %s -> %s (key %s from %s, project %s)\n", v.Stack, v.Endpoint, v.KeyHint, v.KeySource, v.Project)
	printTelemetryRun(v.Run)
}

func printTelemetryRun(st *telemetrysim.RunStatus) {
	if st == nil {
		fmt.Println("no run yet")
		return
	}
	fmt.Printf("%s: %s %s seed %d -> %s (%s, gzip %t): %s\n", st.ID, st.Mode, st.Preset, st.Seed, st.Endpoint, st.Encoding, st.Gzip, st.State)
	fmt.Printf("sent %d  acked %d  refused %d  failed %d  retried %d  late %d\n", st.Sent, st.Acked, st.Refused, st.Failed, st.Retried, st.Late)
	printTelemetryAnswers(st)
	findings := 0
	for _, m := range st.Mutations {
		if m.Error != "" || m.Status >= 500 {
			findings++
			fmt.Printf("finding %s: %d %s\n", m.ID, m.Status, m.Error)
		}
	}
	if len(st.Mutations) > 0 {
		fmt.Printf("mutations %d, findings %d\n", len(st.Mutations), findings)
	}
	if st.LastError != "" {
		fmt.Printf("last error: %s\n", st.LastError)
	}
}
