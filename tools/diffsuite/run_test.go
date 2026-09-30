package diffsuite

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

const (
	stopSignIn  = `echo "apidiff: stopping: setup failed: sign-in refused"; exit 3`
	stopTimeout = `echo "fuzz: stopping: 10 consecutive errors, most common cause: page.goto: Timeout 30000ms (x10)"; exit 3`
	stopOther   = `echo "visualdiff: stopping: something odd"; exit 3`
	sleepy      = `sleep 30`
)

func suiteRun(t *testing.T, flags []string, tools ...string) (int, string, map[string]any) {
	t.Helper()
	out := t.TempDir()
	args := append(append([]string{"-out", out}, flags...), "--")
	code := Run(append(args, tools...), io.Discard)
	events, _ := os.ReadFile(filepath.Join(out, "events.log"))
	var summary map[string]any
	if body, err := os.ReadFile(filepath.Join(out, "summary.json")); err == nil {
		json.Unmarshal(body, &summary)
	}
	return code, string(events), summary
}

func TestAnyStopsEveryoneOnTheFirstStop(t *testing.T) {
	began := time.Now()
	code, events, summary := suiteRun(t, []string{"-policy", "any"}, "a="+stopSignIn, "b="+sleepy)
	if code != 3 || summary["verdict"] != "stopped" {
		t.Fatalf("code %d summary %v", code, summary)
	}
	if time.Since(began) > 10*time.Second {
		t.Fatal("b was not cancelled")
	}
	for _, want := range []string{"diffsuite: stopping all: ", "[b] EXIT 143", "[a] EXIT 3", "all runs ended: "} {
		if !strings.Contains(events, want) {
			t.Errorf("events missing %q:\n%s", want, events)
		}
	}
}

func TestHalfCancelsAtHalfOrTwoWithTheSameCause(t *testing.T) {
	code, _, _ := suiteRun(t, nil, "a="+stopOther, "b="+stopTimeout, "c=sleep 30", "d=sleep 30")
	if code != 3 {
		t.Fatalf("half of four stopped: want 3, got %d", code)
	}
	code, events, _ := suiteRun(t, nil, "a="+stopSignIn, "b=sleep 1", "c=sleep 1")
	if code != 3 || strings.Contains(events, "stopping all") {
		t.Fatalf("one of three is under half: code %d\n%s", code, events)
	}
	code, events, _ = suiteRun(t, nil, "a="+stopSignIn, "b="+stopSignIn, "c=sleep 30", "d=sleep 30", "e=sleep 30")
	if code != 3 || !strings.Contains(events, "same cause: sign-in") {
		t.Fatalf("two sign-in stops: code %d\n%s", code, events)
	}
}

func TestSameCauseIgnoresDifferentAndOtherCauses(t *testing.T) {
	_, events, _ := suiteRun(t, []string{"-policy", "same-cause"}, "a="+stopSignIn, "b="+stopTimeout, "c="+stopOther, "d="+stopOther, "e=sleep 1")
	if strings.Contains(events, "stopping all") {
		t.Fatalf("no shared cause, nothing to cancel:\n%s", events)
	}
}

func TestNoneNeverCancelsAndExitsWithTheHighestCode(t *testing.T) {
	code, events, summary := suiteRun(t, []string{"-policy", "none"}, "a="+stopSignIn, "b=sleep 1; exit 2")
	if code != 3 || summary["verdict"] != "failed" || !strings.Contains(events, "[b] EXIT 2") {
		t.Fatalf("code %d summary %v\n%s", code, summary, events)
	}
	if code, _, summary := suiteRun(t, nil, "a=true", "b=true"); code != 0 || summary["verdict"] != "passed" {
		t.Fatalf("all passed: code %d summary %v", code, summary)
	}
	if code, _, _ := suiteRun(t, []string{"-policy", "none"}, "a=exit 1", "b=exit 2"); code != 2 {
		t.Fatalf("highest tool exit: got %d", code)
	}
}

func TestEventsLogKeepsRunAllLines(t *testing.T) {
	script := `echo hello; echo "FAIL x"; echo "1 flows passed"; echo "scenarios: 12 run" >&2; echo "ERROR y"; echo "panic: z"; echo fatal error; echo "ERRORS"`
	_, events, _ := suiteRun(t, nil, "tool="+script)
	want := "[tool] FAIL x\n[tool] 1 flows passed\n[tool] scenarios: 12 run\n[tool] ERROR y\n[tool] panic: z\n[tool] fatal error\n[tool] EXIT 0\nall runs ended: "
	if !strings.HasPrefix(events, want) {
		t.Fatalf("events:\n%s", events)
	}
}

func TestHealthGate(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }))
	defer down.Close()
	out := t.TempDir()
	if code := Run([]string{"-out", out, "-health", down.URL, "--", "a=touch " + filepath.Join(out, "ran")}, io.Discard); code != 2 {
		t.Fatalf("unhealthy start: got %d", code)
	}
	if _, err := os.Stat(filepath.Join(out, "ran")); err == nil {
		t.Fatal("tool started on an unhealthy stack")
	}
}

func TestThreeHealthFailuresStopAll(t *testing.T) {
	healthEvery = 30 * time.Millisecond
	defer func() { healthEvery = 30 * time.Second }()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) > 1 {
			w.WriteHeader(503)
		}
	}))
	defer server.Close()
	code, events, summary := suiteRun(t, []string{"-health", server.URL, "-policy", "none"}, "a="+sleepy)
	if code != 3 || summary["stopReason"] != "stack unhealthy" || !strings.Contains(events, "diffsuite: stopping all: stack unhealthy") {
		t.Fatalf("code %d summary %v\n%s", code, summary, events)
	}
}

func TestCancelKillsTheWholeProcessGroup(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "pid")
	suiteRun(t, []string{"-policy", "any"}, "a=sleep 300 & echo $! > "+pidFile+"; wait", "b=sleep 0.3; "+stopSignIn)
	body, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(body)))
	for range 40 {
		if syscall.Kill(pid, 0) != nil {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	syscall.Kill(pid, syscall.SIGKILL)
	t.Fatal("child of a cancelled tool is still running")
}

func TestKillAfterGraceWhenTermIsIgnored(t *testing.T) {
	killGrace = 200 * time.Millisecond
	defer func() { killGrace = 20 * time.Second }()
	code, events, _ := suiteRun(t, []string{"-policy", "any"}, `a=trap "" TERM; while :; do sleep 1; done`, "b=sleep 0.3; "+stopSignIn)
	if code != 3 || !strings.Contains(events, "[a] EXIT 137") {
		t.Fatalf("code %d\n%s", code, events)
	}
}

func TestClassify(t *testing.T) {
	for reason, want := range map[string]string{
		"setup failed: sign-in refused":        "sign-in",
		"setup failed: dial: ECONNREFUSED":     "stack-unreachable",
		"3 errors: page.goto: Timeout 30000ms": "timeout",
		"target closed":                        "browser-closed",
		"something odd":                        "other",
	} {
		if got := classify(reason); got != want {
			t.Errorf("classify(%q) = %s, want %s", reason, got, want)
		}
	}
}
