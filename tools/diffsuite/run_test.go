package diffsuite

import (
	"context"
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

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/havenrun"
	"github.com/langwatch/langwatch/tools/visualdiff"
)

const (
	stopSignIn  = `echo "apidiff: stopping: setup failed: sign-in refused"; exit 3`
	stopTimeout = `echo "fuzz: stopping: 10 consecutive errors, most common cause: page.goto: Timeout 30000ms (x10)"; exit 3`
	stopOther   = `echo "visualdiff: stopping: something odd"; exit 3`
	sleepy      = `sleep 30`
)

// TestMain stands a fake haven in: every stack it reads is one live server.
func TestMain(m *testing.M) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	haven.read = func(_ context.Context, slug string) (diffkit.SharedStack, error) {
		return diffkit.SharedStack{Slug: slug, AppURL: server.URL, APIOrigin: server.URL}, nil
	}
	stdout = io.Discard
	code := m.Run()
	server.Close()
	os.Exit(code)
}

func suiteRun(t *testing.T, flags []string, tools ...string) (int, string, map[string]any) {
	t.Helper()
	out := t.TempDir()
	args := append(append([]string{"-out", out, "-tools", ""}, flags...), "--")
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
	if code := Run([]string{"-out", out, "-tools", "", "-health", down.URL, "--", "a=touch " + filepath.Join(out, "ran")}, io.Discard); code != 2 {
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

func TestToolsReadTheSuiteStacksFromTheEnvironment(t *testing.T) {
	seen := filepath.Join(t.TempDir(), "seen")
	code, _, _ := suiteRun(t, []string{"-stack", "branchy", "-main-stack", "mainly"},
		"a=echo $DIFFSUITE_BRANCH_STACK $DIFFSUITE_MAIN_STACK $DIFFSUITE_OUT > "+seen)
	body, _ := os.ReadFile(seen)
	if fields := strings.Fields(string(body)); code != 0 || len(fields) != 3 || fields[0] != "branchy" || fields[1] != "mainly" {
		t.Fatalf("code %d, the tool saw %q", code, body)
	}
}

// fakeStarts records what the suite starts and stops, and restores haven after the test.
func fakeStarts(t *testing.T) *[]string {
	t.Helper()
	saved, calls := haven, &[]string{}
	t.Cleanup(func() { haven = saved })
	haven.up = func(_ context.Context, _, slug string, deltas []string, env havenrun.EnvOptions, _ io.Writer) error {
		*calls = append(*calls, strings.TrimSpace("up "+slug+" "+strings.Join(append(deltas, env.Extra...), " ")))
		return nil
	}
	haven.destroy = func(_, slug string, _ io.Writer) { *calls = append(*calls, "destroy "+slug) }
	haven.upMain = func(_ context.Context, request visualdiff.MainStackRequest) (string, func(), error) {
		*calls = append(*calls, "up "+request.Slug)
		return "", func() { *calls = append(*calls, "stop "+request.Slug) }, nil
	}
	return calls
}

func TestStacksItStartedAreStoppedAndPassedOnesLeftAlone(t *testing.T) {
	calls := fakeStarts(t)
	suiteRun(t, []string{"-up", "-main"}, "a=exit 1")
	got := strings.Join(*calls, "\n")
	if len(*calls) != 4 || !strings.HasPrefix((*calls)[2], "stop diffsuite-") || !strings.HasPrefix((*calls)[3], "destroy diffsuite-") {
		t.Fatalf("want up branch, up main, stop main, destroy branch:\n%s", got)
	}
	*calls = nil
	suiteRun(t, []string{"-stack", "given", "-main-stack", "given-main"}, "a=true")
	if len(*calls) != 0 {
		t.Fatalf("passed-in stacks were touched: %v", *calls)
	}
}

func TestCancelStopsTheToolsThenTheStacks(t *testing.T) {
	calls := fakeStarts(t)
	started := filepath.Join(t.TempDir(), "started")
	go func() {
		for range 200 {
			if _, err := os.Stat(started); err == nil {
				syscall.Kill(os.Getpid(), syscall.SIGINT)
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()
	code, events, _ := suiteRun(t, []string{"-up"}, "a=touch "+started+"; sleep 30")
	if code != 3 || !strings.Contains(events, "stopping all: cancelled") || len(*calls) != 2 || !strings.HasPrefix((*calls)[1], "destroy ") {
		t.Fatalf("code %d calls %v\n%s", code, *calls, events)
	}
}

func TestSuiteToolsDefaultsReplaceAndExtend(t *testing.T) {
	tools, err := suiteTools(defaultNames(), []string{"visual+=-only a", "api=echo hi", "extra=true"})
	if err != nil || len(tools) != 5 {
		t.Fatalf("%v %d", err, len(tools))
	}
	if !strings.HasSuffix(tools[1].command, "check -routes -all -only a") || tools[1].binary != "visualdiff" {
		t.Errorf("extend: %+v", tools[1])
	}
	if tools[0].command != "echo hi" || tools[0].binary != "" {
		t.Errorf("replace: %+v", tools[0])
	}
	for _, bad := range [][]string{{"nope+=x"}, {"noequals"}} {
		if _, err := suiteTools(nil, bad); err == nil {
			t.Errorf("%v: want an error", bad)
		}
	}
	if _, err := suiteTools([]string{"nope"}, nil); err == nil {
		t.Error("unknown default: want an error")
	}
}

// @scenario "A diffsuite stack can run langevals"
func TestLangevalsAddsItsDeltaToTheBranchStackItStarts(t *testing.T) {
	calls := fakeStarts(t)
	suiteRun(t, []string{"-up", "-langevals"}, "a=exit 0")
	if len(*calls) == 0 || !strings.HasPrefix((*calls)[0], "up diffsuite-") || !strings.HasSuffix((*calls)[0], "-branch +langevals") {
		t.Fatalf("want the branch stack brought up with +langevals, got %q", *calls)
	}
}

// @scenario "diffsuite runs the self-hosted pass on a stack of its own"
func TestSelfHostedStartsItsOwnStackWithSaaSOff(t *testing.T) {
	calls := fakeStarts(t)
	suiteRun(t, []string{"-up", "-deployment", "self-hosted"}, "a=exit 0")
	if len(*calls) == 0 || !strings.HasPrefix((*calls)[0], "up diffsuite-") || !strings.HasSuffix((*calls)[0], "-selfhosted IS_SAAS=false") {
		t.Fatalf("want a selfhosted stack brought up with IS_SAAS=false, got %q", *calls)
	}
	*calls = nil
	suiteRun(t, []string{"-up"}, "a=exit 0")
	if len(*calls) == 0 || strings.Contains((*calls)[0], "IS_SAAS") {
		t.Fatalf("a SaaS stack must keep the .env's IS_SAAS, got %q", *calls)
	}
}

func TestSelfHostedAdoptsTheSelfHostedSlugByDefault(t *testing.T) {
	seen := filepath.Join(t.TempDir(), "seen")
	code, _, _ := suiteRun(t, []string{"-deployment", "self-hosted"}, "a=echo $DIFFSUITE_BRANCH_STACK > "+seen)
	if body, _ := os.ReadFile(seen); code != 0 || strings.TrimSpace(string(body)) != selfHostedSlug {
		t.Fatalf("code %d, the tool saw %q", code, body)
	}
}

func TestDeploymentFlagRefusals(t *testing.T) {
	fakeStarts(t)
	for _, flags := range [][]string{{"-deployment", "onprem"}, {"-deployment", "self-hosted", "-main"}, {"-deferred", "x"}} {
		if code, _, _ := suiteRun(t, flags, "a=exit 0"); code != 2 {
			t.Errorf("%v: code %d, want 2", flags, code)
		}
	}
}

func TestSelfHostedRefusesAStackThatAnswersAsSaaS(t *testing.T) {
	saved := haven.read
	t.Cleanup(func() { haven.read = saved })
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/organizations" {
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	haven.read = func(_ context.Context, slug string) (diffkit.SharedStack, error) {
		return diffkit.SharedStack{Slug: slug, AppURL: server.URL, APIOrigin: server.URL}, nil
	}
	if code, _, _ := suiteRun(t, []string{"-deployment", "self-hosted"}, "a=exit 0"); code != 2 {
		t.Fatalf("self-hosted: code %d, want 2", code)
	}
	if code, _, _ := suiteRun(t, nil, "a=exit 0"); code != 0 {
		t.Fatalf("a SaaS run takes the same stack: code %d, want 0", code)
	}
}

func TestDeferredNarrowsTheAPIToolToTheListedScenarios(t *testing.T) {
	seen := filepath.Join(t.TempDir(), "seen")
	list := filepath.Join(t.TempDir(), "deferred.txt")
	code, _, _ := suiteRun(t, []string{"-deployment", "self-hosted", "-deferred", list}, "api=echo > "+seen)
	if body, _ := os.ReadFile(seen); code != 0 || strings.TrimSpace(string(body)) != "-scenario-id @"+list {
		t.Fatalf("code %d, the api tool saw %q", code, body)
	}
}
