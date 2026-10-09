package apidiff

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakePnpm puts a pnpm on PATH that prints 120 numbered lines and exits 1,
// so a worker spawned through it dies at once with a log to tail.
func fakePnpm(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	script := "#!/bin/sh\ni=1\nwhile [ $i -le 120 ]; do echo \"worker line $i\"; i=$((i+1)); done\nexit 1\n"
	// #nosec G306 -- the stand-in pnpm must be executable.
	if err := os.WriteFile(filepath.Join(dir, "pnpm"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func deadWorkerState(t *testing.T, log *bytes.Buffer) *bootState {
	t.Helper()
	workRoot := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workRoot, "logs"), 0o700); err != nil {
		t.Fatal(err)
	}
	state := &bootState{stderr: log, workRoot: workRoot, runID: "deadworker"}
	state.infra = infraURLs{
		pgServer: "postgres://apidiff@127.0.0.1:5432/postgres", chServer: "http://127.0.0.1:8123",
		redisServer: "redis://127.0.0.1:6379", branchRedis: 3, mainRedis: 11,
	}
	return state
}

// @scenario "A worker that exits a second time stops the run naming its side"
func TestASecondWorkerExitStopsTheRunNamingTheSide(t *testing.T) {
	fakePnpm(t)
	var log bytes.Buffer
	state := deadWorkerState(t, &log)
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	state.abort = cancel
	first := exec.CommandContext(ctx, "false")
	if err := first.Start(); err != nil {
		t.Skip("no false binary")
	}

	state.respawnOnEarlyExit(ctx, first, instanceProcess{instance: Instance{Name: "main"}, logName: "main-worker"})

	var dead *workerDeathError
	if !errors.As(context.Cause(ctx), &dead) || dead.side != "base (main)" {
		t.Fatalf("cause = %v, want a worker death on the base side", context.Cause(ctx))
	}
	if want := filepath.Join(state.workRoot, "logs", "main-worker.log"); dead.logPath != want {
		t.Errorf("log path = %q, want %q", dead.logPath, want)
	}
	for _, want := range []string{"base (main) worker exited a second time", "worker line 21\n", "worker line 120"} {
		if !strings.Contains(log.String(), want) {
			t.Errorf("stop output lacks %q:\n%s", want, log.String())
		}
	}
	if strings.Contains(log.String(), "worker line 20\n") {
		t.Errorf("stop output holds more than the last %d lines:\n%s", workerLogTail, log.String())
	}
}

// @scenario "A worker that exits a second time stops the run naming its side"
func TestABranchWorkerThatDiesTwiceIsNamedAsTheBranch(t *testing.T) {
	fakePnpm(t)
	var log bytes.Buffer
	state := deadWorkerState(t, &log)
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	state.abort = cancel
	first := exec.CommandContext(ctx, "false")
	if err := first.Start(); err != nil {
		t.Skip("no false binary")
	}

	state.respawnOnEarlyExit(ctx, first, instanceProcess{instance: Instance{Name: "branch"}, logName: "branch-worker"})

	if dead := workerDeath(ctx); dead == nil || dead.side != "branch" {
		t.Fatalf("cause = %v, want a worker death on the branch side", context.Cause(ctx))
	}
}

// @scenario "A worker killed by teardown does not stop the run"
func TestAWorkerKilledByTeardownIsNotADeath(t *testing.T) {
	fakePnpm(t)
	var log bytes.Buffer
	state := deadWorkerState(t, &log)
	state.tornDown.Store(true)
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	state.abort = cancel
	first := exec.CommandContext(ctx, "false")
	if err := first.Start(); err != nil {
		t.Skip("no false binary")
	}

	state.respawnOnEarlyExit(ctx, first, instanceProcess{instance: Instance{Name: "main"}, logName: "main-worker"})

	if dead := workerDeath(ctx); dead != nil {
		t.Fatalf("teardown read as a worker death: %v", dead)
	}
}

// @scenario "A fixture trace that never reads back stops the run before probing"
func TestAnUnreadableFixtureTraceStopsTheRunBeforeProbing(t *testing.T) {
	previous := fixtureTraceWait
	fixtureTraceWait = 50 * time.Millisecond
	t.Cleanup(func() { fixtureTraceWait = previous })
	routes := func(readable bool) map[string]http.HandlerFunc {
		return map[string]http.HandlerFunc{
			otlpTracesPath: func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) },
			"/api/traces/" + fixtureTraceID: func(w http.ResponseWriter, _ *http.Request) {
				if readable {
					w.WriteHeader(http.StatusOK)
					return
				}
				w.WriteHeader(http.StatusNotFound)
			},
		}
	}
	branch := newTestServer(t, `{"openapi":"3.1.0","info":{"title":"t","version":"1"},"paths":{}}`, routes(false))
	base := newTestServer(t, `{"openapi":"3.1.0","info":{"title":"t","version":"1"},"paths":{}}`, routes(true))
	var progress bytes.Buffer
	operations := []Operation{{Method: http.MethodGet, Path: "/api/things", InA: true, InB: true}}

	result := ProbeAll(context.Background(), ProbeOptions{
		A: branch.URL, B: base.URL, Progress: &progress, Timeout: time.Second,
		WorkerLogA: "/run/logs/branch-worker.log", WorkerLogB: "/run/logs/main-worker.log",
	}, operations)

	for _, want := range []string{"the branch side " + branch.URL, "see /run/logs/branch-worker.log"} {
		if !strings.Contains(result.Fatal, want) {
			t.Errorf("Fatal lacks %q: %q", want, result.Fatal)
		}
	}
	if strings.Contains(result.Fatal, "main-worker.log") || result.Probed != 0 {
		t.Errorf("only the branch side is unreadable and nothing is probed: probed %d, %q", result.Probed, result.Fatal)
	}
	if fmt.Sprint(result.Findings) != "[]" {
		t.Errorf("findings = %v, want none", result.Findings)
	}
}

// @scenario "A documentation-only spec change is ruled for the kind it was given for"
func TestDocumentationOnlySpecChangesAreRuledByKind(t *testing.T) {
	cases := []struct {
		method, path, kind string
		ruled              bool
	}{
		{"GET", "/", "operation_removed", true},
		{"POST", "/", "operation_removed", true},
		{"GET", "/", "operation_added", false},
		{"GET", "/api/prompts", "operation_removed", false},
		{"POST", "/api/langy/control/connect/register", "operation_security_changed", true},
		{"GET", "/api/langy/control/connect/poll", "operation_security_changed", true},
		{"POST", "/api/langy/control/connect/frames", "operation_security_changed", true},
		{"POST", "/api/langy/control/connect/frames", "operation_response_required_changed", true},
		{"GET", "/api/agents/connect/poll", "operation_security_changed", false},
	}
	for _, testCase := range cases {
		if got := ruledSpecChange(testCase.method, testCase.path, testCase.kind) != ""; got != testCase.ruled {
			t.Errorf("%s %s %s: ruled = %v, want %v", testCase.method, testCase.path, testCase.kind, got, testCase.ruled)
		}
	}
}
