// Package havenrun is what the tools that run against a haven stack share to
// find it: argv for status and logs, readiness from `haven status --json`,
// and the local TLS trust for its routes.
package havenrun

import (
	"encoding/json"
	"fmt"
	"os/exec"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Command is the orchestrator binary every path in this package shells out
// to.
const Command = "haven"

// UILane and BackendLane name the two Node lanes haven supervises (see
// tools/thuishaven/domain/stack.go, Stack.Lanes). A caller names the lanes it
// needs ready.
// BackendLane is "api" since haven named the lane for what it serves;
// LegacyBackendLane is what a stack started before that still reports.
const (
	UILane            = "ui"
	BackendLane       = "api"
	LegacyBackendLane = "backend"
)

// AppService is the routed service name whose URL is the browser-facing
// origin: the UI, with the API served under /api on the same origin.
const AppService = "app"

// OnPath reports whether the orchestrator is installed.
func OnPath() bool {
	_, err := exec.LookPath(Command)
	return err == nil
}

// StatusArgs asks for the machine-readable one-shot report.
func StatusArgs() []string { return []string{"status", "--agent", "--json", "stacks"} }

// LogArgs reads one stack's named lane log, for a boot that never became
// ready. A monolith stack has no "backend" lane to read - AppService names
// its one Node lane instead, so a caller picks the lane the stack actually
// runs (see StackStatus.IsMonolith).
func LogArgs(lane, slug string) []string {
	return []string{"logs", lane, "--agent", "--stack", slug}
}

// Status is the slice of `haven status --json` this package reads.
type Status struct {
	Stacks []StackStatus `json:"stacks"`
}

// StackStatus is one registered stack.
type StackStatus struct {
	Slug     string        `json:"slug"`
	APIPort  int           `json:"apiPort"`
	Live     bool          `json:"live"`
	Lanes    []LaneStatus  `json:"lanes"`
	Services []ServiceItem `json:"services"`
	// Layout is the checkout shape the stack was brought up from (see
	// tools/thuishaven/domain/layout.go). Empty reads as modular, same as a
	// stack recorded before the field existed.
	Layout domain.Layout `json:"layout,omitempty"`
}

// IsMonolith reports whether this stack runs the monolith checkout's single
// app lane instead of the modular checkout's ui and backend lanes.
func (stack StackStatus) IsMonolith() bool {
	return stack.Layout.IsMonolith()
}

// LaneStatus is one supervised Node lane plus whether it is listening.
type LaneStatus struct {
	Name      string `json:"name"`
	Listening bool   `json:"listening"`
}

// ServiceItem is one routed service's hostname and loopback port.
type ServiceItem struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Port int    `json:"port"`
}

// ServiceURL returns the routed URL haven allocated for a named service (for
// example AppService), and whether the stack reported one.
func (stack StackStatus) ServiceURL(name string) (string, bool) {
	for _, service := range stack.Services {
		if service.Name == name && service.URL != "" {
			return service.URL, true
		}
	}
	return "", false
}

// ParseStatus decodes a `haven status --json` report.
func ParseStatus(output []byte) (Status, error) {
	var report Status
	if err := json.Unmarshal(output, &report); err != nil {
		return Status{}, fmt.Errorf("haven status --json: %w", err)
	}
	return report, nil
}

// StackReady finds the named, live stack whose every required lane is
// listening. Ready is haven's own answer, never a guess from elapsed time: a
// stack that is not live, or missing any required lane, is not ready. A
// monolith stack runs one lane, AppService, so a caller asking for UILane or
// BackendLane is answered by that lane instead (see resolveRequiredLanes).
func StackReady(status Status, slug string, requiredLanes ...string) (StackStatus, bool) {
	for _, stack := range status.Stacks {
		if stack.Slug != slug || !stack.Live {
			continue
		}
		if lanesListening(stack.Lanes, resolveRequiredLanes(stack.IsMonolith(), requiredLanes)) {
			return stack, true
		}
	}
	return StackStatus{}, false
}

// resolveRequiredLanes translates UILane and BackendLane into AppService for
// a monolith stack, deduplicating so two required lanes collapsing into one
// name are asked about once.
func resolveRequiredLanes(monolith bool, requiredLanes []string) []string {
	if !monolith {
		return requiredLanes
	}
	resolved := make([]string, 0, len(requiredLanes))
	seen := map[string]bool{}
	for _, lane := range requiredLanes {
		name := lane
		if lane == UILane || lane == BackendLane {
			name = AppService
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		resolved = append(resolved, name)
	}
	return resolved
}

// laneAnswers reports whether a reported lane name satisfies a required one.
func laneAnswers(reported, required string) bool {
	return reported == required || (required == BackendLane && reported == LegacyBackendLane)
}

func lanesListening(lanes []LaneStatus, required []string) bool {
	for _, name := range required {
		found := false
		for _, lane := range lanes {
			if laneAnswers(lane.Name, name) && lane.Listening {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
