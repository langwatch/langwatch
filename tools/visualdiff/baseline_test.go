package visualdiff

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// cachingFake answers everything a baseline- and edition-aware haven run
// asks the machine: the base commit, both stacks' readiness, their database
// address and the seeded license.
type cachingFake struct {
	haven    fakeHavenRunner
	mutex    sync.Mutex
	commands []string
}

const testBaseCommit = "0123456789abcdef0123456789abcdef01234567"

func (fake *cachingFake) run(ctx context.Context, spec commandSpec, log io.Writer) error {
	line := spec.name + " " + strings.Join(spec.args, " ")
	fake.mutex.Lock()
	fake.commands = append(fake.commands, line)
	fake.mutex.Unlock()
	switch {
	case spec.name == "git" && len(spec.args) > 0 && spec.args[0] == "rev-parse":
		_, err := io.WriteString(log, testBaseCommit+"\n")
		return err
	case spec.name == "haven" && strings.HasPrefix(strings.Join(spec.args, " "), "db url"):
		_, err := io.WriteString(log, "postgres    postgresql://stack/"+slugFromEnv(spec.env)+"\n")
		return err
	case spec.name == "psql" && strings.Contains(line, "SELECT"):
		_, err := io.WriteString(log, "signed-enterprise-license\n")
		return err
	}
	return fake.haven.run(ctx, spec, log)
}

func (fake *cachingFake) matching(fragment string) []string {
	fake.mutex.Lock()
	defer fake.mutex.Unlock()
	var out []string
	for _, line := range fake.commands {
		if strings.Contains(line, fragment) {
			out = append(out, line)
		}
	}
	return out
}

// cachingRun is a haven run over a root that carries the runner's own source,
// which every baseline key hashes.
func cachingRun(t *testing.T) (Options, *cachingFake, Deps) {
	t.Helper()
	options := testOptions(t)
	options.UseHaven, options.Baseline = true, true
	options.Editions = []Edition{EditionEnterprise, EditionFree}
	source := filepath.Join(options.Root, runnerSourceDir)
	if err := os.MkdirAll(source, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "main.ts"), []byte("capture()"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := &cachingFake{haven: fakeHavenRunner{readyStacks: map[string]string{
		"visualdiff-run-base":       "https://app.visualdiff-run-base.langwatch.localhost",
		"visualdiff-run-candidate":  "https://app.visualdiff-run-candidate.langwatch.localhost",
		"visualdiff-run2-candidate": "https://app.visualdiff-run2-candidate.langwatch.localhost",
	}}}
	deps := passingDeps(&fakeRunner{}, nil, nil)
	deps.Run = fake.run
	deps.Environ = func() []string { return []string{"HOME=/home/user"} }
	deps.CopyEnv = func(context.Context, string, string) (int, error) { return 0, nil }
	return options, fake, deps
}

// @scenario "A run against a base it has already rendered never boots the base"
func TestARunReplaysACachedBaselineAndNeverBootsTheBase(t *testing.T) {
	options, fake, deps := cachingRun(t)
	shot := filepath.Join(options.Root, "base.png")
	if err := os.WriteFile(shot, []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	var handed []RunnerPlan
	deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
		handed = append(handed, plan)
		return RunnerStream{Captures: []Capture{
			{Kind: "route", Key: "/settings", Side: "base", Screenshot: shot},
			{Kind: "route", Key: "/settings", Side: "candidate", Screenshot: shot},
		}}, nil
	}

	t.Run("given no baseline yet, the base renders live and is cached per edition", func(t *testing.T) {
		if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard}); err != nil {
			t.Fatalf("Execute: %v", err)
		}
		if len(fake.matching("worktree add --force --detach "+PersistentWorktree(options.Root, "base"))) != 1 {
			t.Fatalf("the base was not checked out on the first run: %v", fake.commands)
		}
		for _, plan := range handed {
			if plan.Sides[0].Replay != "" {
				t.Errorf("%s replayed a baseline that did not exist yet", plan.Edition)
			}
		}
		slots, _ := filepath.Glob(filepath.Join(options.Root, ".visualdiff", BaselinesDir, testBaseCommit[:12]+"-*"))
		if len(slots) != 2 {
			t.Fatalf("want one cached baseline per edition, got %v", slots)
		}
	})

	t.Run("when the same base is diffed again, both editions replay and the base is never booted", func(t *testing.T) {
		fake.commands, handed = nil, nil
		again := options
		again.RunDir = filepath.Join(options.Root, "run2")
		if _, err := Execute(context.Background(), Request{Options: again, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard}); err != nil {
			t.Fatalf("Execute: %v", err)
		}
		if got := fake.matching("/base"); len(got) != 0 {
			t.Errorf("the base was touched on a fully cached run: %v", got)
		}
		if got := fake.matching("up --agent --detach"); len(got) != 1 {
			t.Errorf("want exactly the candidate booted, got %v", got)
		}
		for _, plan := range handed {
			if !strings.HasPrefix(plan.Sides[0].Replay, filepath.Join(options.Root, ".visualdiff", BaselinesDir)) {
				t.Errorf("%s base side = %+v, want a replay from the baseline", plan.Edition, plan.Sides[0])
			}
		}
	})

	t.Run("when the configuration changes, the baseline no longer matches", func(t *testing.T) {
		changed := testConfig()
		changed.Routes = append(changed.Routes, "/me")
		baselines, err := resolveBaselines(context.Background(), baselineInputs{options: options, config: changed, deps: deps})
		if err != nil {
			t.Fatal(err)
		}
		if needsLiveBase(options.Editions, baselines) == false {
			t.Error("a changed route list replayed a baseline recorded for the old one")
		}
	})
}

// @scenario "Every screen is captured once per edition"
func TestEveryScreenIsCapturedOncePerEdition(t *testing.T) {
	options, fake, deps := cachingRun(t)
	options.Baseline = false
	var editions []Edition
	deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
		editions = append(editions, plan.Edition)
		if !strings.HasSuffix(plan.OutDir, string(plan.Edition)) {
			t.Errorf("%s pass writes into %s", plan.Edition, plan.OutDir)
		}
		return RunnerStream{}, nil
	}

	if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard}); err != nil {
		t.Fatalf("Execute: %v", err)
	}

	if len(editions) != 2 || editions[0] != EditionEnterprise || editions[1] != EditionFree {
		t.Fatalf("passes = %v, want enterprise then free", editions)
	}
	updates := fake.matching("UPDATE")
	if len(updates) != 2 {
		t.Fatalf("the enterprise pass runs on the seeded license and the free pass clears it on both stacks; updates = %v", updates)
	}
	for _, update := range updates {
		if !strings.Contains(update, "license = NULL") || !strings.Contains(update, SeededOrganizationID) {
			t.Errorf("free pass ran %q", update)
		}
	}
}

// @scenario "The free edition is refused where the database is the developer's own"
func TestTheFreeEditionIsRefusedWithoutHaven(t *testing.T) {
	options := testOptions(t)
	options.Editions = []Edition{EditionFree}
	_, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: passingDeps(&fakeRunner{}, nil, nil)}, Streams{Out: io.Discard, Err: io.Discard})
	if err == nil || !strings.Contains(err.Error(), "-editions enterprise") {
		t.Fatalf("err = %v, want a refusal naming -editions enterprise", err)
	}
	if editions, _ := runEditions("", true); len(editions) != 1 || editions[0] != EditionEnterprise {
		t.Errorf("-no-haven defaults to %v, want enterprise alone", editions)
	}
}

// @scenario "A baseline is keyed on what changes a capture, and replays only what it covers"
func TestABaselineIsKeyedOnWhatChangesACapture(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, runnerSourceDir)
	if err := os.MkdirAll(filepath.Join(source, "flows"), 0o750); err != nil {
		t.Fatal(err)
	}
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(source, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("settle.ts", "settle()")
	write("main.ts", "main()")
	key := func(config *Config) string {
		t.Helper()
		got, err := BaselineKey(baselineKeyInputs{commit: testBaseCommit, edition: EditionEnterprise, config: config, viewport: Viewport{Width: 1440, Height: 900}, root: root})
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	first := key(testConfig())

	t.Run("a new route, a scheduling change and a new day keep the key", func(t *testing.T) {
		more := testConfig()
		more.Routes = append(more.Routes, "/me")
		more.Concurrency = Concurrency{Routes: 4}
		write("main.ts", "main({ pages: 4 })")
		if key(more) != first {
			t.Error("the key moved on something that does not change a capture")
		}
	})

	t.Run("a settle source or the settle config moves it", func(t *testing.T) {
		slower := testConfig()
		slower.Settle.DeadlineMillis = 20000
		if key(slower) == first {
			t.Error("a different settle deadline kept the key")
		}
		write("settle.ts", "settle({ longLived: 8000 })")
		if key(testConfig()) == first {
			t.Error("a settle source change kept the key")
		}
	})

	t.Run("a baseline answers only the routes and flow steps it recorded", func(t *testing.T) {
		config := testConfig()
		meta := BaselineMeta{Routes: config.Routes, Flows: flowHashes(config.Flows)}
		if !meta.Covers(config.Routes, flowHashes(config.Flows)) {
			t.Error("a baseline does not cover the plan it was recorded for")
		}
		if meta.Covers(append(config.Routes, "/me"), nil) {
			t.Error("a baseline covered a route it never recorded")
		}
		edited := testConfig()
		edited.Flows[0].Steps = append(edited.Flows[0].Steps, Step{Action: "go"})
		if meta.Covers(config.Routes, flowHashes(edited.Flows)) {
			t.Error("a baseline covered a flow whose steps changed")
		}
	})
}

// @scenario "A screen whose modules still did not load is a capture failure, not a blank page"
func TestABaseWhoseModulesDidNotLoadIsNeverCached(t *testing.T) {
	captures := []Capture{
		{Side: "base", Key: "/a"},
		{Side: "base", Key: "/b", ModuleFailures: []string{"FAIL GET /@fs/x.tsx net::ERR_CONNECTION_CLOSED"}},
		{Side: "candidate", Key: "/b", ModuleFailures: []string{"FAIL GET /@fs/x.tsx net::ERR_CONNECTION_CLOSED"}},
	}
	if got := UnloadedBaseCaptures(captures); got != 1 {
		t.Fatalf("unloaded base captures: %d", got)
	}
}
