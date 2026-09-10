package visualdiff

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// These cases bind specs/tooling/visualdiff-on-haven.feature. Every one
// drives the real session boot stages against a fake haven, so what is
// asserted is the argv and the environment a run would actually hand the
// orchestrator.

// fakeHavenRunner answers the haven commands a run makes. readyStacks are the
// slugs whose ui and backend lanes are listening, mapped to the app hostname
// haven allocated for them.
type fakeHavenRunner struct {
	commands    []commandSpec
	readyStacks map[string]string // slug -> app service URL
	backendLog  string
}

func (fake *fakeHavenRunner) run(_ context.Context, spec commandSpec, log io.Writer) error {
	fake.commands = append(fake.commands, spec)
	switch {
	case len(spec.args) > 0 && spec.args[0] == "status":
		_, err := io.WriteString(log, fake.statusJSON())
		return err
	case len(spec.args) > 0 && spec.args[0] == "logs":
		_, err := io.WriteString(log, fake.backendLog)
		return err
	}
	return nil
}

// statusJSON renders the slice of `haven status --json` this package reads:
// every ready stack, both lanes listening, and its app service URL.
func (fake *fakeHavenRunner) statusJSON() string {
	var stacks []string
	for slug, url := range fake.readyStacks {
		stacks = append(stacks, `{"slug":"`+slug+`","live":true,`+
			`"lanes":[{"name":"ui","listening":true},{"name":"backend","listening":true}],`+
			`"services":[{"name":"app","url":"`+url+`"}]}`)
	}
	return `{"stacks":[` + strings.Join(stacks, ",") + `]}`
}

// argv joins one recorded command back into the line a person would type.
func haventArgv(spec commandSpec) string {
	return spec.name + " " + strings.Join(spec.args, " ")
}

// slugFromEnv reads LANGWATCH_SLUG out of a composed environment.
func slugFromEnv(env []string) string {
	for _, entry := range env {
		if name, value, found := strings.Cut(entry, "="); found && name == "LANGWATCH_SLUG" {
			return value
		}
	}
	return ""
}

const testRunID = "20260909t2230"

// havenTestSession builds a session on the haven path with a fake
// orchestrator, its two stacks already checked out (so tests that only care
// about up/wait/teardown do not also have to fake `git worktree add`).
func havenTestSession(fake *fakeHavenRunner, timeout time.Duration) *session {
	options := Options{Root: "/repos/langwatch", BootTimeout: timeout, UseHaven: true}
	deps := Deps{
		Run: fake.run,
		Environ: func() []string {
			return []string{
				"HOME=/home/user", "OPENAI_API_KEY=sk-user",
				"DATABASE_URL=postgres://real:secret@127.0.0.1:5432/lw_feat_x",
				"REDIS_URL=redis://127.0.0.1:6379", "REDIS_DB_INDEX=13",
				"CLICKHOUSE_URL=http://127.0.0.1:8123/lw_feat_x",
			}
		},
		// The env-copy step's real implementation reads the developer's own
		// workspace root off disk (see CopyEnvFiles in haven.go); these tests
		// care about the haven boot sequence, not that, and "/repos/langwatch"
		// above is not a real directory, so it is stubbed out here. The
		// dedicated env-copy tests exercise the real implementation directly.
		CopyEnv: func(context.Context, string, string) (int, error) { return 0, nil },
	}
	base := Stack{Name: "base", Ref: "origin/main", Dir: "/repos/langwatch/.visualdiff/run/base", HavenSlug: HavenSlug(testRunID, "base")}
	candidate := Stack{Name: "candidate", Ref: "HEAD", Dir: "/repos/langwatch/.visualdiff/run/candidate", HavenSlug: HavenSlug(testRunID, "candidate")}
	return &session{
		request: Request{Options: options, Deps: deps},
		streams: Streams{Out: io.Discard, Err: io.Discard},
		plan:    Plan{Base: base, Candidate: candidate, UseHaven: true, RunID: testRunID},
		runID:   testRunID,
	}
}

// @scenario "Each stack gets a run-scoped slug"
func TestEachStackGetsARunScopedSlug(t *testing.T) {
	t.Run("given a run whose run directory names run 20260909t2230", func(t *testing.T) {
		if got := RunID("/repos/langwatch/.visualdiff/20260909t2230"); got != testRunID {
			t.Fatalf("RunID = %q, want %q", got, testRunID)
		}

		t.Run("when the base and candidate stacks are planned, each is its own slug", func(t *testing.T) {
			cases := []struct{ stack, want string }{
				{"base", "visualdiff-20260909t2230-base"},
				{"candidate", "visualdiff-20260909t2230-candidate"},
			}
			for _, testCase := range cases {
				if got := HavenSlug(testRunID, testCase.stack); got != testCase.want {
					t.Errorf("HavenSlug(%q) = %q, want %q", testCase.stack, got, testCase.want)
				}
			}
		})

		t.Run("when each is started, LANGWATCH_SLUG names it and the run is in agent mode", func(t *testing.T) {
			fake := &fakeHavenRunner{readyStacks: map[string]string{
				"visualdiff-20260909t2230-base":      "https://app.visualdiff-20260909t2230-base.langwatch.localhost",
				"visualdiff-20260909t2230-candidate": "https://app.visualdiff-20260909t2230-candidate.langwatch.localhost",
			}}
			run := havenTestSession(fake, time.Minute)
			run.request.Deps.Layout = func(string) (Layout, error) { return LayoutModular, nil }
			if err := run.bringUpHaven(context.Background()); err != nil {
				t.Fatalf("bringUpHaven: %v", err)
			}
			ups := map[string]commandSpec{}
			for _, spec := range fake.commands {
				if len(spec.args) > 0 && spec.args[0] == "up" {
					ups[slugFromEnv(spec.env)] = spec
				}
			}
			for _, slug := range []string{"visualdiff-20260909t2230-base", "visualdiff-20260909t2230-candidate"} {
				spec, ok := ups[slug]
				if !ok {
					t.Fatalf("no up carried LANGWATCH_SLUG=%s; ups were %v", slug, ups)
				}
				if got := haventArgv(spec); got != "haven up --agent --detach" {
					t.Errorf("%s ran %q, want the agent-mode non-attached up", slug, got)
				}
			}
			if ups["visualdiff-20260909t2230-base"].dir != "/repos/langwatch/.visualdiff/run/base" {
				t.Errorf("the base stack must come up in its own worktree, got %q", ups["visualdiff-20260909t2230-base"].dir)
			}
			if ups["visualdiff-20260909t2230-candidate"].dir != "/repos/langwatch/.visualdiff/run/candidate" {
				t.Errorf("the candidate stack must come up in its own worktree, got %q", ups["visualdiff-20260909t2230-candidate"].dir)
			}
		})
	})
}

// @scenario "A slug never collides with a developer's stack"
func TestVisualdiffSlugNeverCollidesWithADevelopersStack(t *testing.T) {
	// haven derives a worktree's slug from its directory name or its branch.
	// Neither ever produces the visualdiff prefix, so the check is that our
	// slugs carry it and that a slug haven derived does not.
	derived := []string{
		domain.SlugFromBranch("feat/strict-feature-layout-v0"),
		domain.DeriveSlug("/repos/worktrees/portless", nil),
		domain.DeriveSlug("/repos/langwatch", nil),
		domain.SlugFromBranch("main"),
	}
	for _, stack := range []string{"base", "candidate"} {
		slug := HavenSlug(testRunID, stack)
		if !strings.HasPrefix(slug, havenSlugPrefix+"-") {
			t.Errorf("slug %q must start with %q", slug, havenSlugPrefix+"-")
		}
		if !domain.ValidSlug(slug) {
			t.Errorf("slug %q is not a slug haven would accept", slug)
		}
		for _, other := range derived {
			if slug == other {
				t.Errorf("slug %q equals the worktree-derived slug %q", slug, other)
			}
			if strings.HasPrefix(other, havenSlugPrefix+"-") {
				t.Errorf("worktree-derived slug %q took the visualdiff prefix", other)
			}
		}
	}
}

// @scenario "Isolation comes from haven, not from AllocateRedisDBs"
func TestIsolationComesFromHavenNotAllocateRedisDBs(t *testing.T) {
	datastoreKeys := []string{"DATABASE_URL", "CLICKHOUSE_URL", "REDIS_URL", "REDIS_DB_INDEX"}

	t.Run("when a stack's haven commands are composed, no datastore address is one of ours", func(t *testing.T) {
		env := havenEnv([]string{
			"HOME=/home/user",
			"DATABASE_URL=postgres://real:secret@127.0.0.1:5432/lw_feat_x",
			"CLICKHOUSE_URL=http://127.0.0.1:8123/lw_feat_x",
			"REDIS_URL=redis://127.0.0.1:6379",
			"REDIS_DB_INDEX=13",
		}, "visualdiff-20260909t2230-base")
		joined := strings.Join(env, "\n")
		for _, key := range datastoreKeys {
			if strings.Contains(joined, key+"=") {
				t.Errorf("%s must not reach haven from visualdiff:\n%s", key, joined)
			}
		}
		for _, want := range []string{"HOME=/home/user", "LANGWATCH_SLUG=visualdiff-20260909t2230-base"} {
			if !strings.Contains(joined, want) {
				t.Errorf("env missing %q:\n%s", want, joined)
			}
		}
	})

	t.Run("when a run boots through haven, AllocateRedisDBs never runs and no port is allocated", func(t *testing.T) {
		// testOptions' run dir basename is "run", so that is what RunID
		// derives both slugs from here.
		fake := &fakeHavenRunner{readyStacks: map[string]string{
			"visualdiff-run-base":      "https://app.visualdiff-run-base.langwatch.localhost",
			"visualdiff-run-candidate": "https://app.visualdiff-run-candidate.langwatch.localhost",
		}}
		deps := passingDeps(&fakeRunner{}, nil, nil)
		deps.Run = fake.run
		deps.Layout = func(string) (Layout, error) { return LayoutModular, nil }
		deps.Environ = func() []string { return []string{"HOME=/home/user"} }
		allocateCalled := false
		deps.AllocateRedis = func(context.Context) (RedisAllocation, error) {
			allocateCalled = true
			return RedisAllocation{}, nil
		}
		listeningCalled := false
		deps.Listening = func(int) bool { listeningCalled = true; return false }
		options := testOptions(t)
		options.UseHaven = true

		result, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard})
		if err != nil {
			t.Fatalf("Execute: %v", err)
		}
		if allocateCalled {
			t.Error("AllocateRedisDBs ran on the haven path")
		}
		if listeningCalled {
			t.Error("a port-liveness check ran on the haven path; haven allocates no ephemeral port for this tool to check")
		}
		for _, stack := range []Stack{result.Plan.Base, result.Plan.Candidate} {
			if stack.Ports != (Ports{}) || stack.BasePort != 0 {
				t.Errorf("%s holds a port of visualdiff's own allocation: %+v", stack.Name, stack.Ports)
			}
		}
		// The worktree checkout and its removal still run through git, and
		// each worktree still runs its own install/generated-files/build
		// prepare steps (haven's own automatic prep is migrate-and-seed, not
		// install-and-build - see HavenPrepareCommands in haven.go) - but
		// none of that is a datastore address of visualdiff's own choosing.
		for _, spec := range fake.commands {
			switch spec.name {
			case havenrun.Command, "git", "env", "pnpm", "node":
			default:
				t.Errorf("unexpected command %q on the haven path", haventArgv(spec))
			}
		}
	})
}

// @scenario "Teardown names its own two slugs"
func TestTeardownNamesItsOwnTwoSlugsVisualdiff(t *testing.T) {
	fake := &fakeHavenRunner{readyStacks: map[string]string{
		"visualdiff-20260909t2230-base":      "https://app.visualdiff-20260909t2230-base.langwatch.localhost",
		"visualdiff-20260909t2230-candidate": "https://app.visualdiff-20260909t2230-candidate.langwatch.localhost",
	}}
	run := havenTestSession(fake, time.Minute)
	run.request.Deps.Layout = func(string) (Layout, error) { return LayoutModular, nil }
	if err := run.bringUpHaven(context.Background()); err != nil {
		t.Fatalf("bringUpHaven: %v", err)
	}

	before := len(fake.commands)
	if err := run.teardownHaven(context.Background()); err != nil {
		t.Fatalf("teardownHaven: %v", err)
	}
	var destroys, removes []string
	for _, spec := range fake.commands[before:] {
		switch {
		case len(spec.args) > 0 && spec.args[0] == "destroy":
			destroys = append(destroys, haventArgv(spec))
		case len(spec.args) > 0 && spec.args[0] == "worktree":
			removes = append(removes, haventArgv(spec))
		default:
			t.Errorf("teardown also ran %q; it may only destroy what it started", haventArgv(spec))
		}
	}
	wantDestroys := []string{
		"haven destroy visualdiff-20260909t2230-base --agent --yes",
		"haven destroy visualdiff-20260909t2230-candidate --agent --yes",
	}
	if strings.Join(destroys, "\n") != strings.Join(wantDestroys, "\n") {
		t.Errorf("teardown ran\n%s\nwant\n%s", strings.Join(destroys, "\n"), strings.Join(wantDestroys, "\n"))
	}
	if len(removes) != 2 {
		t.Errorf("teardown must remove exactly the two worktrees it added, got %v", removes)
	}
}

// @scenario "A failed boot still tears down only its own slugs"
func TestAFailedBootTearsDownOnlyItsOwnSlugsVisualdiff(t *testing.T) {
	fake := &fakeHavenRunner{
		readyStacks: map[string]string{"visualdiff-20260909t2230-base": "https://app.visualdiff-20260909t2230-base.langwatch.localhost"},
		backendLog:  "line one\nEACCES: permission denied, open '/repos/.../server.mts'\n",
	}
	run := havenTestSession(fake, 10*time.Millisecond)
	run.request.Deps.Layout = func(string) (Layout, error) { return LayoutModular, nil }

	err := run.bringUpHaven(context.Background())
	if err == nil {
		t.Fatal("a stack that never becomes ready must fail the boot")
	}
	for _, want := range []string{"visualdiff-20260909t2230-candidate", "EACCES: permission denied"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("failure %q must name %q", err.Error(), want)
		}
	}

	before := len(fake.commands)
	if err := run.teardownHaven(context.Background()); err != nil {
		t.Fatalf("teardownHaven: %v", err)
	}
	var destroyed []string
	for _, spec := range fake.commands[before:] {
		if len(spec.args) > 1 && spec.args[0] == "destroy" {
			destroyed = append(destroyed, spec.args[1])
		}
	}
	want := []string{"visualdiff-20260909t2230-base", "visualdiff-20260909t2230-candidate"}
	if strings.Join(destroyed, ",") != strings.Join(want, ",") {
		t.Errorf("destroyed %v, want %v", destroyed, want)
	}
}

// @scenario "The instance URL is the stack's app address"
func TestTheStacksURLIsItsAppAddress(t *testing.T) {
	fake := &fakeHavenRunner{readyStacks: map[string]string{
		"visualdiff-20260909t2230-base":      "https://app.visualdiff-20260909t2230-base.langwatch.localhost",
		"visualdiff-20260909t2230-candidate": "https://app.visualdiff-20260909t2230-candidate.langwatch.localhost",
	}}
	run := havenTestSession(fake, time.Minute)
	run.request.Deps.Layout = func(string) (Layout, error) { return LayoutModular, nil }
	if err := run.bringUpHaven(context.Background()); err != nil {
		t.Fatalf("bringUpHaven: %v", err)
	}

	cases := []struct{ name, got, want string }{
		{"base", run.plan.Base.URL(), "https://app.visualdiff-20260909t2230-base.langwatch.localhost"},
		{"candidate", run.plan.Candidate.URL(), "https://app.visualdiff-20260909t2230-candidate.langwatch.localhost"},
	}
	for _, testCase := range cases {
		if testCase.got != testCase.want {
			t.Errorf("%s URL = %q, want %q", testCase.name, testCase.got, testCase.want)
		}
	}
	// The API is served under /api on that same routed origin - APIURL() and
	// URL() must be the one address a browser and the seeder both use.
	if run.plan.Base.APIURL() != run.plan.Base.URL() || run.plan.Candidate.APIURL() != run.plan.Candidate.URL() {
		t.Errorf("APIURL must be the same origin as URL on the haven path: base %q/%q, candidate %q/%q",
			run.plan.Base.APIURL(), run.plan.Base.URL(), run.plan.Candidate.APIURL(), run.plan.Candidate.URL())
	}
}

// @scenario "Ready means haven reports the ui and backend lanes healthy"
func TestReadyMeansBothLanesAreHealthy(t *testing.T) {
	const slug = "visualdiff-20260909t2230-base"
	status := func(uiUp, backendUp, live bool, port ...string) havenrun.Status {
		url := ""
		if len(port) > 0 {
			url = port[0]
		}
		var services []havenrun.ServiceItem
		if url != "" {
			services = []havenrun.ServiceItem{{Name: "app", URL: url}}
		}
		return havenrun.Status{Stacks: []havenrun.StackStatus{{
			Slug: slug, Live: live,
			Lanes:    []havenrun.LaneStatus{{Name: "ui", Listening: uiUp}, {Name: "backend", Listening: backendUp}},
			Services: services,
		}}}
	}
	cases := []struct {
		name   string
		report havenrun.Status
		want   bool
	}{
		{name: "both lanes listening with an app URL is ready", report: status(true, true, true, "https://app.x.langwatch.localhost"), want: true},
		{name: "only the ui lane is not ready", report: status(true, false, true, "https://app.x.langwatch.localhost")},
		{name: "only the backend lane is not ready", report: status(false, true, true, "https://app.x.langwatch.localhost")},
		{name: "both lanes listening but the launcher is dead is not ready", report: status(true, true, false, "https://app.x.langwatch.localhost")},
		{name: "both lanes listening with no app service is not ready", report: status(true, true, true)},
		{name: "no stack at all is not ready", report: havenrun.Status{}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, got := havenStackURL(testCase.report, slug)
			if got != testCase.want {
				t.Errorf("havenStackURL = %v, want %v", got, testCase.want)
			}
		})
	}

	t.Run("when the run waits, it polls haven status --json", func(t *testing.T) {
		fake := &fakeHavenRunner{readyStacks: map[string]string{slug: "https://app.x.langwatch.localhost"}}
		run := havenTestSession(fake, time.Minute)
		stack := run.plan.Base
		if err := run.havenWaitReady(context.Background(), &stack); err != nil {
			t.Fatalf("havenWaitReady: %v", err)
		}
		if got := haventArgv(fake.commands[0]); got != "haven status --agent --json" {
			t.Errorf("readiness asked %q, want the machine-readable status", got)
		}
	})
}

// @scenario "visualdiff does not gate the haven path on layout"
func TestHavenPathDoesNotGateOnLayout(t *testing.T) {
	fake := &fakeHavenRunner{readyStacks: map[string]string{
		"visualdiff-20260909t2230-base":      "https://app.visualdiff-20260909t2230-base.langwatch.localhost",
		"visualdiff-20260909t2230-candidate": "https://app.visualdiff-20260909t2230-candidate.langwatch.localhost",
	}}
	run := havenTestSession(fake, time.Minute)
	// The base ref is still on the monolith layout (origin/main today).
	// visualdiff never refuses this up front on the haven path - it runs the
	// same haven up / haven status commands either way and lets haven's own
	// readiness answer decide, unlike apidiff's profile gate.
	run.request.Deps.Layout = func(dir string) (Layout, error) {
		if strings.HasSuffix(dir, "base") {
			return LayoutMonolith, nil
		}
		return LayoutModular, nil
	}

	if err := run.bringUpHaven(context.Background()); err != nil {
		t.Fatalf("bringUpHaven must not refuse a monolith ref up front: %v", err)
	}
	if run.plan.Base.Layout != LayoutMonolith {
		t.Fatalf("the base stack's detected layout must still be recorded: %v", run.plan.Base.Layout)
	}
	ups := 0
	for _, spec := range fake.commands {
		if len(spec.args) > 0 && spec.args[0] == "up" {
			ups++
		}
	}
	if ups != 2 {
		t.Fatalf("both stacks must still get a haven up, monolith included: %d", ups)
	}
}

// @scenario "A monolith base is ready when its app lane is healthy"
func TestVisualdiffMonolithStackIsReadyWhenItsAppLaneIsHealthy(t *testing.T) {
	const slug = "visualdiff-20260909t2230-base"
	appURL := "https://app." + slug + ".langwatch.localhost"

	t.Run("given haven status reports the stack as the monolith layout", func(t *testing.T) {
		report := havenrun.Status{Stacks: []havenrun.StackStatus{{
			Slug: slug, Live: true, Layout: domain.LayoutMonolith,
			Lanes:    []havenrun.LaneStatus{{Name: havenrun.AppService, Listening: true}},
			Services: []havenrun.ServiceItem{{Name: havenrun.AppService, URL: appURL}},
		}}}

		t.Run("when the stack is addressed, it is ready at the app hostname", func(t *testing.T) {
			url, ready := havenStackURL(report, slug)
			if !ready {
				t.Fatal("a monolith stack whose app lane is listening must be ready")
			}
			if url != appURL {
				t.Errorf("url = %q, want the routed app hostname %q", url, appURL)
			}
		})
	})

	t.Run("given the app lane is not listening", func(t *testing.T) {
		report := havenrun.Status{Stacks: []havenrun.StackStatus{{
			Slug: slug, Live: true, Layout: domain.LayoutMonolith,
			Lanes: []havenrun.LaneStatus{{Name: havenrun.AppService, Listening: false}},
		}}}
		t.Run("when the stack is addressed, it is not ready", func(t *testing.T) {
			if _, ready := havenStackURL(report, slug); ready {
				t.Error("a monolith stack whose app lane is down must not be ready")
			}
		})
	})
}

// @scenario "A monolith base's failure tail reads the app lane"
func TestVisualdiffMonolithBasesFailureTailReadsTheAppLane(t *testing.T) {
	t.Run("given the base stack is the monolith layout", func(t *testing.T) {
		fake := &fakeHavenRunner{backendLog: "line one\nEACCES: permission denied, open '/repos/.../server.mts'\n"}
		run := havenTestSession(fake, time.Minute)
		stack := run.plan.Base
		stack.Layout = LayoutMonolith

		t.Run("when the run gives up, the tail comes from the app lane's own log", func(t *testing.T) {
			got := run.havenBackendLog(context.Background(), stack)
			if !strings.Contains(got, "EACCES: permission denied") {
				t.Errorf("log tail = %q, want the fake log content", got)
			}
			var logCmd commandSpec
			for _, spec := range fake.commands {
				if len(spec.args) > 0 && spec.args[0] == "logs" {
					logCmd = spec
				}
			}
			if got := haventArgv(logCmd); got != "haven logs app --agent --stack "+stack.HavenSlug {
				t.Errorf("logs command = %q, want the app lane", got)
			}
		})
	})

	t.Run("given the stack is the modular layout", func(t *testing.T) {
		fake := &fakeHavenRunner{backendLog: "modular log"}
		run := havenTestSession(fake, time.Minute)
		stack := run.plan.Base
		stack.Layout = LayoutModular

		t.Run("when the run gives up, the tail still comes from the backend lane", func(t *testing.T) {
			run.havenBackendLog(context.Background(), stack)
			var logCmd commandSpec
			for _, spec := range fake.commands {
				if len(spec.args) > 0 && spec.args[0] == "logs" {
					logCmd = spec
				}
			}
			if got := haventArgv(logCmd); got != "haven logs backend --agent --stack "+stack.HavenSlug {
				t.Errorf("logs command = %q, want the backend lane", got)
			}
		})
	})
}

// @scenario "haven is the default when present"
// @scenario "-no-haven keeps the port-based path"
func TestHavenIsTheDefaultAndNoHavenOptsOut(t *testing.T) {
	cases := []struct {
		name           string
		onPath, wanted bool
	}{
		{name: "haven on PATH selects the haven path", onPath: true, wanted: true},
		{name: "no haven on PATH keeps the port-based path"},
	}
	for _, testCase := range cases {
		if got := havenSelected(testCase.onPath, false); got != testCase.wanted {
			t.Errorf("%s: havenSelected(onPath=%v, noHaven=false) = %v, want %v", testCase.name, testCase.onPath, got, testCase.wanted)
		}
	}
	if havenSelected(true, true) {
		t.Error("-no-haven must keep the port-based path even when haven is on PATH")
	}
}

// A boot error must never be swallowed as "not ready yet" forever - this
// pins that a haven status command failing outright still respects the boot
// timeout rather than looping past it.
func TestHavenWaitReadyRespectsTheTimeoutOnACommandError(t *testing.T) {
	fake := &fakeHavenRunner{}
	run := havenTestSession(fake, 10*time.Millisecond)
	run.request.Deps.Run = func(_ context.Context, spec commandSpec, _ io.Writer) error {
		fake.commands = append(fake.commands, spec)
		if len(spec.args) > 0 && spec.args[0] == "status" {
			return errors.New("connection refused")
		}
		return nil
	}
	stack := run.plan.Base
	err := run.havenWaitReady(context.Background(), &stack)
	if err == nil {
		t.Fatal("a status command that always errors must still fail within the boot timeout")
	}
	mustContain(t, err.Error(), stack.HavenSlug)
}
