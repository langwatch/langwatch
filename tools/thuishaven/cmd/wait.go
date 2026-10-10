package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const defaultWaitTimeout = 5 * time.Minute

func waitSpec() commandSpec {
	return commandSpec{
		name:    "wait",
		summary: "block until this stack is ready or stopped; exit 66 when --timeout runs out",
		flags: []flagSpec{
			{long: "--for", takesValue: true, value: "<ready|stopped>", summary: "the state to wait for"},
			{long: "--timeout", takesValue: true, value: "<dur>", summary: "how long to wait (default 5m)"},
		},
		run: runWait,
	}
}

// runWait is `haven wait --for ready|stopped`: poll the stack's cheap
// snapshot until it reaches the state, bounded by --timeout.
func runWait(ctx context.Context, d deps, inv invocation) error {
	want := inv.value("--for")
	if want != "ready" && want != "stopped" {
		return usageErr("haven wait needs --for ready|stopped")
	}
	timeout := defaultWaitTimeout
	if v := inv.value("--timeout"); v != "" {
		parsed, err := time.ParseDuration(v)
		if err != nil || parsed <= 0 {
			return usageErr("--timeout %q is not a duration, e.g. 30s or 5m", v)
		}
		timeout = parsed
	}
	slug := d.resolvedStack()
	if slug == "" {
		return usageErr("haven wait: no stack here; pass --stack <slug>")
	}
	deadline := time.Now().Add(timeout)
	for {
		snap := d.orch.SessionSnapshot(slug)
		if reached(snap, want) {
			fmt.Printf("%s is %s\n", slug, want)
			return nil
		}
		if time.Now().After(deadline) {
			if want == "ready" {
				return timeoutErr("%s was not ready within %s; not answering: %s", slug, timeout, strings.Join(notUp(snap), ", "))
			}
			return timeoutErr("%s was not stopped within %s", slug, timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// reached reports whether the snapshot is in the wanted state: ready is a
// live stack whose own services all answer; stopped is no live stack.
func reached(snap app.SessionReport, want string) bool {
	if want == "stopped" {
		return !snap.Live
	}
	return snap.Found && snap.Live && len(notUp(snap)) == 0
}

// notUp is this stack's own services that do not answer yet.
func notUp(snap app.SessionReport) []string {
	var names []string
	if !snap.Live {
		names = append(names, "the stack itself")
	}
	for _, s := range snap.Services {
		if !s.Shared && !s.Fallback && !s.Up {
			names = append(names, s.Name)
		}
	}
	return names
}

func defaultsSpec() commandSpec {
	return commandSpec{
		name:      "defaults",
		summary:   "the machine-wide services a new stack starts with: +svc/-svc edits them, bare lists them",
		args:      "[+svc|-svc …]",
		maxArgs:   -1,
		minusArgs: true,
		flags:     []flagSpec{{long: "--json", summary: "machine-readable"}},
		run:       runDefaults,
	}
}

// machineDefaultsPath holds the default set as service deltas on top of
// haven's own default selection.
func machineDefaultsPath() string { return filepath.Join(havenHome(), "defaults.json") }

type machineDefaults struct {
	Services []string `json:"services"`
}

func readMachineDefaults() []string {
	raw, err := os.ReadFile(machineDefaultsPath())
	if err != nil {
		return nil
	}
	var m machineDefaults
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m.Services
}

// runDefaults is `haven defaults [+svc -svc]`.
func runDefaults(_ context.Context, d deps, inv invocation) error {
	deltas := readMachineDefaults()
	if len(inv.args) > 0 {
		deltas = mergeDeltas(deltas, inv.args)
		if _, err := domain.ApplySelectionDeltasForLayout(domain.DefaultSelection(), deltas, domain.LayoutModular); err != nil {
			return usageErr("%v", err)
		}
		raw, err := json.MarshalIndent(machineDefaults{Services: deltas}, "", "  ")
		if err != nil {
			return err
		}
		if err := os.MkdirAll(havenHome(), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(machineDefaultsPath(), append(raw, '\n'), 0o600); err != nil {
			return err
		}
	}
	if inv.has("--json") || d.isAgent {
		return json.NewEncoder(os.Stdout).Encode(machineDefaults{Services: deltas})
	}
	if len(deltas) == 0 {
		fmt.Println("defaults: haven's own (no machine-wide changes); a new stack starts with them")
		return nil
	}
	fmt.Println("defaults: " + strings.Join(deltas, " ") + " (on top of haven's own; a new stack starts with them)")
	return nil
}

// mergeDeltas applies later deltas over earlier ones: one entry per service,
// the last sign wins.
func mergeDeltas(prior, next []string) []string {
	sign := map[string]string{}
	for _, delta := range append(slices.Clone(prior), next...) {
		if len(delta) > 1 && (delta[0] == '+' || delta[0] == '-') {
			sign[delta[1:]] = delta[:1]
		}
	}
	out := make([]string, 0, len(sign))
	for name, s := range sign {
		out = append(out, s+name)
	}
	slices.Sort(out)
	return out
}

// upDeltas is the selection change an up asks for: on a stack's first up the
// machine defaults come first, so the stack's own choices win.
func upDeltas(d deps, args []string) []string {
	if d.orch.HasSelection(d.worktree) {
		return args
	}
	return append(readMachineDefaults(), args...)
}
