package visualdiff

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testConfig() *Config {
	return &Config{
		Routes: []string{"/{slug}/traces", "/settings"},
		Flows: []Flow{
			{ID: "prompt-create", Title: "Add a prompt", Steps: []Step{{Action: "createPrompt"}}},
			{ID: "annotate", Title: "Annotate a trace", Steps: []Step{{Action: "annotate"}}},
		},
	}
}

func testOptions(t *testing.T) Options {
	t.Helper()
	root := t.TempDir()
	return Options{
		Root: root, BaseRef: "origin/main", CandidateRef: "HEAD",
		RunDir: filepath.Join(root, "run"), Viewport: Viewport{Width: 1440, Height: 900},
		BootTimeout: time.Second, Identity: SeedIdentity{ProjectKey: DefaultProjectKey, Slug: "vd"},
	}
}

func passingDeps(fake *fakeRunner, captures []Capture, diffs []Diff) Deps {
	return Deps{
		Run:   fake.run,
		Start: func(context.Context, Stack, string) (func(), error) { return func() {}, nil },
		Wait:  func(context.Context, []string, time.Duration) error { return nil },
		Seed:  func(context.Context, SeedRequest) (SeedResult, error) { return SeedResult{}, nil },
		Capture: func(context.Context, RunnerPlan, CaptureOptions) (RunnerStream, error) {
			return RunnerStream{Captures: captures, Diffs: diffs}, nil
		},
		Listening: func(int) bool { return false },
		Layout:    func(string) (Layout, error) { return LayoutModular, nil },
		Now:       func() time.Time { return time.Unix(0, 0).UTC() },
		AllocateRedis: func(context.Context) (RedisAllocation, error) {
			return RedisAllocation{Base: 3, Candidate: 4}, nil
		},
	}
}

// @scenario A run captures the route list and the flow list on both refs
func TestExecuteCapturesEveryRouteAndEveryFlowOnBothRefs(t *testing.T) {
	fake := &fakeRunner{}
	var handed RunnerPlan
	deps := passingDeps(fake, nil, nil)
	deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
		handed = plan
		return RunnerStream{}, nil
	}
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}

	if _, err := Execute(context.Background(), Request{Options: testOptions(t), Config: testConfig(), Deps: deps}, Streams{Out: stdout, Err: stderr}); err != nil {
		t.Fatal(err)
	}

	if len(handed.Sides) != 2 || handed.Sides[0].Name != "base" || handed.Sides[1].Name != "candidate" {
		t.Fatalf("both refs must be driven: %+v", handed.Sides)
	}
	if len(handed.Routes) != 2 || len(handed.Flows) != 2 {
		t.Fatalf("routes and flows both go to the runner: %+v", handed)
	}
	if handed.Viewport.Width != 1440 {
		t.Fatalf("viewport: %+v", handed.Viewport)
	}
}

// @scenario A run captures the route list and the flow list on both refs
func TestRoutesOnlySkipsTheFlows(t *testing.T) {
	var handed RunnerPlan
	deps := passingDeps(&fakeRunner{}, nil, nil)
	deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
		handed = plan
		return RunnerStream{}, nil
	}
	options := testOptions(t)
	options.RoutesOnly = true

	if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard}); err != nil {
		t.Fatal(err)
	}

	if len(handed.Flows) != 0 {
		t.Fatalf("-routes-only must hand the runner no flows: %+v", handed.Flows)
	}
}

// @scenario A run tears its stacks down even when a step fails
func TestExecuteTearsDownWhenTheCaptureFails(t *testing.T) {
	fake := &fakeRunner{}
	deps := passingDeps(fake, nil, nil)
	deps.Capture = func(context.Context, RunnerPlan, CaptureOptions) (RunnerStream, error) {
		return RunnerStream{}, errors.New("the browser died")
	}
	stderr := &bytes.Buffer{}

	result, err := Execute(context.Background(), Request{Options: testOptions(t), Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: stderr})

	if err == nil {
		t.Fatal("a failed capture was reported as a clean run")
	}
	commands := fake.rendered()
	if !strings.Contains(strings.Join(commands, "\n"), KillDevTreeScript) {
		t.Fatalf("teardown did not free the ports: %v", commands)
	}
	removals := 0
	for _, command := range commands {
		if strings.HasPrefix(command, "git worktree remove") {
			removals++
		}
	}
	if removals != 2 {
		t.Fatalf("both worktrees should be removed: %v", commands)
	}
	if ExitCode(result, err) != ExitOperational {
		t.Fatalf("a failed run exits %d", ExitCode(result, err))
	}
}

// @scenario A run tears its stacks down even when a step fails
func TestAWorktreeThatWasNeverCreatedIsNotRemoved(t *testing.T) {
	fake := &fakeRunner{fail: map[string]error{}}
	deps := passingDeps(fake, nil, nil)
	options := testOptions(t)
	fake.fail["git worktree add --detach "+filepath.Join(options.RunDir, "base")+" origin/main"] = errors.New("no such ref")

	if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard}); err == nil {
		t.Fatal("a failed worktree add was reported as a clean run")
	}

	for _, command := range fake.rendered() {
		if strings.HasPrefix(command, "git worktree remove") {
			t.Fatalf("nothing was checked out, so nothing should be removed: %v", fake.rendered())
		}
	}
}

// @scenario A run exits 0 with no findings, 1 with findings and 2 on an operational failure
func TestExitCodeReportsTheVerdict(t *testing.T) {
	clean := Result{Rows: []Row{{Class: ClassNoise}}}
	found := Result{Rows: []Row{{Class: ClassRegression}}, Findings: 1}

	if code := ExitCode(clean, nil); code != ExitClean {
		t.Fatalf("no findings exits %d", code)
	}
	if code := ExitCode(found, nil); code != ExitFindings {
		t.Fatalf("findings exit %d", code)
	}
	if code := ExitCode(clean, errors.New("boot failed")); code != ExitOperational {
		t.Fatalf("an operational failure exits %d", code)
	}
}

// @scenario A run diffs the captures and writes a report
func TestExecuteWritesTheReportAndCountsTheFindings(t *testing.T) {
	captures := []Capture{
		{Kind: "route", Key: "/settings", Side: "base"},
		{Kind: "route", Key: "/settings", Side: "candidate", ConsoleErrors: []string{"pageerror: boom"}},
	}
	deps := passingDeps(&fakeRunner{}, captures, []Diff{{Kind: "route", Key: "/settings", Ratio: 0.4}})
	options := testOptions(t)
	stdout := &bytes.Buffer{}

	result, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: stdout, Err: io.Discard})

	if err != nil {
		t.Fatal(err)
	}
	if result.Findings != 1 || ExitCode(result, nil) != ExitFindings {
		t.Fatalf("result: %+v", result)
	}
	for _, name := range []string{"report.html", "findings.md", "findings.json"} {
		if _, err := os.Stat(filepath.Join(result.ReportDir, name)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	mustContain(t, stdout.String(), "1 findings")
}

// @scenario A dry run prints the plan and starts nothing
func TestDryRunPrintsThePlanAndStartsNothing(t *testing.T) {
	fake := &fakeRunner{}
	deps := passingDeps(fake, nil, nil)
	deps.Start = func(context.Context, Stack, string) (func(), error) {
		t.Fatal("a dry run must start nothing")
		return nil, nil
	}
	options := testOptions(t)
	options.DryRun = true
	stdout := &bytes.Buffer{}

	if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: stdout, Err: io.Discard}); err != nil {
		t.Fatal(err)
	}

	printed := stdout.String()
	mustContain(t, printed, "dry run")
	mustContain(t, printed, "ui :5670")
	mustContain(t, printed, "ui :5680")
	mustContain(t, printed, "routes    2")
	mustContain(t, printed, "prompt-create, annotate")
	if len(fake.commands) != 0 {
		t.Fatalf("a dry run creates no worktree: %v", fake.rendered())
	}
	if _, err := os.Stat(options.RunDir); err == nil {
		t.Fatal("a dry run created the run directory")
	}
}

// @scenario A run seeds its fixtures through the candidate API
func TestSeedPostsTracesAndADatasetThroughTheCandidateAPI(t *testing.T) {
	type received struct {
		path string
		key  string
	}
	var calls []received
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, received{r.URL.Path, r.Header.Get("X-Auth-Token")})
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	result, err := Seed(context.Background(), SeedRequest{
		Client: server.Client(), APIURL: server.URL,
		Identity: SeedIdentity{ProjectKey: DefaultProjectKey}, TraceCount: 2,
	})

	if err != nil {
		t.Fatal(err)
	}
	if len(result.TraceIDs) != 2 || !result.DatasetOK {
		t.Fatalf("result: %+v", result)
	}
	if len(calls) != 3 || calls[0].path != "/api/collector" || calls[2].path != "/api/dataset" {
		t.Fatalf("calls: %+v", calls)
	}
	for _, call := range calls {
		if call.key != DefaultProjectKey {
			t.Fatalf("every fixture is posted with the project key: %+v", call)
		}
	}
}

// @scenario A run seeds its fixtures through the candidate API
func TestSeedReportsARejectedFixture(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	_, err := Seed(context.Background(), SeedRequest{
		Client: server.Client(), APIURL: server.URL,
		Identity: SeedIdentity{ProjectKey: "wrong"}, TraceCount: 1,
	})

	if err == nil {
		t.Fatal("a rejected fixture was reported as seeded")
	}
	mustContain(t, err.Error(), "401")
}

// @scenario A run boots both refs on ports that cannot collide
func TestExecuteRefusesToBootOntoAPortSomethingElseHolds(t *testing.T) {
	fake := &fakeRunner{}
	deps := passingDeps(fake, nil, nil)
	deps.Listening = func(port int) bool { return port == 6680 }

	_, err := Execute(context.Background(), Request{Options: testOptions(t), Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard})

	if err == nil {
		t.Fatal("a run booted onto a port another stack holds")
	}
	mustContain(t, err.Error(), "6680")
	mustContain(t, err.Error(), "-base-port")
	if len(fake.commands) != 0 {
		t.Fatalf("nothing should be checked out: %v", fake.rendered())
	}
}
