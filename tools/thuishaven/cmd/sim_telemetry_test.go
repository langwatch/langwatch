package cmd

import (
	"strings"
	"testing"
)

// @scenario "haven sim telemetry targets the worktree's own stack with the overlay key, never printing it"
func TestTelemetryTargetsTheStackOTLPDoorWithTheOverlayKey(t *testing.T) {
	overlay := []string{"LANGWATCH_ENDPOINT=https://app.demo.langwatch.localhost/", "HAVEN_SEED_LANGWATCH_API_KEY=sk-lw-overlay"}
	inv := invocation{flags: map[string]string{"--preset": "logs", "--seed": "7"}, args: []string{"send"}}
	req, err := telemetryRequest("send", inv, overlay)
	if err != nil {
		t.Fatal(err)
	}
	if req.Endpoint != "https://app.demo.langwatch.localhost/api/otel" || req.APIKey != "sk-lw-overlay" || req.Seed != 7 || req.Preset != "logs" || req.Mode != "send" {
		t.Errorf("request %+v", req)
	}
	if _, err := telemetryRequest("send", simInv("send"), nil); err == nil || !strings.Contains(err.Error(), "haven up") {
		t.Errorf("no stack: %v, want a pointer to haven up or --target", err)
	}
	targeted, err := telemetryRequest("load", invocation{flags: map[string]string{"--target": "http://127.0.0.1:4318", "--rate": "50"}}, nil)
	if err != nil || targeted.Endpoint != "http://127.0.0.1:4318" || targeted.Rate != 50 {
		t.Errorf("--target: %+v, %v", targeted, err)
	}
}

// @scenario "haven sim telemetry post, list, get, fixtures and console drive the sim's API"
func TestTelemetryVerbsReadTheSimsAPI(t *testing.T) {
	api, seen := stubSim(t, map[string]string{
		"POST /_sim/api/send-one":               `{"url":"http://door/v1/logs","signal":"logs","encoding":"json","status":415,"latencyMs":1}`,
		"GET /_sim/api/runs":                    `{"runs":[{"id":"run-1","mode":"send","state":"done"}]}`,
		"GET /_sim/api/runs/run-1":              `{"id":"run-1","answers":{"503":2}}`,
		"GET /_sim/api/fixtures":                `{"fixtures":[{"name":"logs","kind":"preset","signal":"logs"}]}`,
		"GET /_sim/api/fixtures/claude-code/s1": `{"name":"claude-code/s1","body":{}}`,
	})
	req, err := telemetryPostRequest(invocation{flags: map[string]string{"--preset": "logs", "--encoding": "json", "--target": "http://door"}}, nil)
	if err != nil || req.Endpoint != "http://door" || req.Preset != "logs" || req.Seed != 1 {
		t.Fatalf("post request %+v, %v", req, err)
	}
	if err := telemetryPost(api, req, false); err != nil {
		t.Errorf("a door refusal must not fail the verb: %v", err)
	}
	for _, args := range [][]string{{"runs"}, {"run", "run-1"}, {"fixtures"}, {"fixture", "claude-code/s1"}} {
		if err := telemetryRead(api, simInv(args...), false); err != nil {
			t.Errorf("%v: %v", args, err)
		}
	}
	if err := telemetryRead(api, simInv("run"), false); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Errorf("run without an id: %v", err)
	}
	if err := telemetryRead(api, simInv("nope"), false); err == nil {
		t.Error("an unknown verb must fail")
	}
	if want := "POST /_sim/api/send-one?"; len(*seen) == 0 || (*seen)[0] != want {
		t.Errorf("calls %v", *seen)
	}
	if _, err := telemetryPostRequest(invocation{flags: map[string]string{"--body-file": "/no/such/file", "--target": "http://door"}}, nil); err == nil {
		t.Error("a missing --body-file must fail")
	}
	if err := telemetryConsole(deps{}, invocation{flags: map[string]string{"--sim": "http://127.0.0.1:5599"}}, true); err != nil {
		t.Errorf("console with --sim: %v", err)
	}
}
