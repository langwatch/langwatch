package cmd

import (
	"strings"
	"testing"
)

// @scenario "haven telemetry targets the worktree's own stack with the overlay key, never printing it"
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
