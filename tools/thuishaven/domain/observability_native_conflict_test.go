package domain

import (
	"strings"
	"testing"
)

// @scenario "A running observability container is stopped before the native tier starts"
func TestObservabilityContainerRunning(t *testing.T) {
	cases := map[string]bool{"true\n": true, "true": true, "false\n": false, "": false}
	for in, want := range cases {
		if got := ObservabilityContainerRunning(in); got != want {
			t.Errorf("ObservabilityContainerRunning(%q) = %v, want %v", in, got, want)
		}
	}
}

// @scenario "A port held by another process is named in the status"
func TestPortConflictNamesComponentPortAndProcess(t *testing.T) {
	holder, held := ParseLsofListener("p4321\ncssh\nf7\n")
	if !held || holder.PID != 4321 || holder.Command != "ssh" {
		t.Fatalf("ParseLsofListener = %+v, %v", holder, held)
	}
	msg := PortConflict(PortConflictQuery{Component: "grafana", Binary: "grafana", Port: 3000, Holder: holder, Held: held})
	for _, want := range []string{"grafana", "3000", "ssh", "4321", "colima port forward"} {
		if !strings.Contains(msg, want) {
			t.Errorf("PortConflict = %q, missing %q", msg, want)
		}
	}
}

// @scenario "A component's own process is not a conflict"
func TestPortConflictIgnoresOwnProcessAndFreePorts(t *testing.T) {
	if _, held := ParseLsofListener(""); held {
		t.Error("empty lsof output reads as held")
	}
	if msg := PortConflict(PortConflictQuery{Component: "prometheus", Binary: "/opt/homebrew/bin/prometheus", Port: 9090, Holder: PortHolder{PID: 9, Command: "prometheus"}, Held: true}); msg != "" {
		t.Errorf("own process reported as conflict: %q", msg)
	}
	if msg := PortConflict(PortConflictQuery{Component: "loki", Binary: "loki", Port: 3100}); msg != "" {
		t.Errorf("free port reported as conflict: %q", msg)
	}
}

func TestNativeComponentPortsIncludePublicEndpoints(t *testing.T) {
	p := NativeObservabilityPlan{
		Endpoints: ObservabilityEndpoints{GrafanaPort: 3000, OTLPHTTPPort: 4318, OTLPGRPCPort: 4317},
		Ports:     DefaultNativeObservabilityPorts(),
	}
	alloy := NativeComponentPorts(p, "alloy")
	if len(alloy) != 3 || alloy[0] != 4317 || alloy[1] != 4318 {
		t.Errorf("alloy ports = %v", alloy)
	}
	if g := NativeComponentPorts(p, "grafana"); len(g) != 1 || g[0] != 3000 {
		t.Errorf("grafana ports = %v", g)
	}
}

// @scenario "Native status reads the server's resident memory from the process"
func TestParsePSRSS(t *testing.T) {
	if b, ok := ParsePSRSS("  524288\n"); !ok || b != 512<<20 {
		t.Errorf("ParsePSRSS = %d, %v; want %d", b, ok, int64(512<<20))
	}
	for _, bad := range []string{"", "rss", "0"} {
		if _, ok := ParsePSRSS(bad); ok {
			t.Errorf("ParsePSRSS(%q) read as valid", bad)
		}
	}
}
