package apidiff

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// These cases bind specs/tooling/apidiff-on-haven.feature. Every one drives
// the real boot stages against a fake haven, so what is asserted is the argv
// and the environment a run would actually hand the orchestrator.

// fakeHaven answers the three haven commands a run makes. readySlugs are the
// stacks whose backend lane is listening; everything else is recorded.
type fakeHaven struct {
	commands   []commandSpec
	readySlugs map[string]int // slug -> apiPort
	backendLog string
}

func (fake *fakeHaven) run(_ context.Context, spec commandSpec, log io.Writer) error {
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

// statusJSON renders the slice of `haven status --json` the tool reads: every
// registered stack, its API port, and its lanes.
func (fake *fakeHaven) statusJSON() string {
	var stacks []string
	for slug, port := range fake.readySlugs {
		stacks = append(stacks, `{"slug":"`+slug+`","apiPort":`+itoa(port)+`,"live":true,`+
			`"lanes":[{"name":"ui","listening":true},{"name":"backend","listening":true}],`+
			`"services":[{"name":"app","url":"https://app.`+slug+`.langwatch.localhost"}]}`)
	}
	return `{"stacks":[` + strings.Join(stacks, ",") + `]}`
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var digits []byte
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}

// argv joins one recorded command back into the line a person would type.
func argv(spec commandSpec) string {
	return spec.name + " " + strings.Join(spec.args, " ")
}

// ran reports whether any recorded command was this executable.
func (fake *fakeHaven) ran(name string) bool {
	for _, spec := range fake.commands {
		if spec.name == name {
			return true
		}
	}
	return false
}

// havenState builds a boot state on the haven path with a fake orchestrator.
func havenState(fake *fakeHaven, timeout time.Duration) *bootState {
	return &bootState{
		cfg:     BootConfig{UseHaven: true, BranchDir: "/repos/langwatch", BootTimeout: timeout},
		stderr:  io.Discard,
		run:     fake.run,
		runID:   "20260909t2230",
		inherit: []string{"HOME=/home/user", "OPENAI_API_KEY=sk-user", "DATABASE_URL=postgres://real:secret@127.0.0.1:5432/lw_feat_x", "REDIS_URL=redis://127.0.0.1:6379", "REDIS_DB_INDEX=13", "CLICKHOUSE_URL=http://127.0.0.1:8123/lw_feat_x"},
	}
}

// bothInstances is the pair a run boots: the developer's own checkout and the
// worktree it added for the base ref.
func bothInstances() *Booted {
	return &Booted{
		A: Instance{Name: "branch", Dir: "/repos/langwatch"},
		B: Instance{Name: "main", Dir: "/repos/langwatch/.apidiff/run/main"},
	}
}

// @scenario "Each instance gets a run-scoped slug"
func TestEachInstanceGetsARunScopedSlug(t *testing.T) {
	t.Run("given a run whose work root names run 20260909t2230", func(t *testing.T) {
		runID := RunID("/repos/langwatch/.apidiff/20260909t2230")
		if runID != "20260909t2230" {
			t.Fatalf("RunID = %q, want %q", runID, "20260909t2230")
		}

		t.Run("when the branch and main instances are planned, each is its own stack", func(t *testing.T) {
			cases := []struct{ instance, want string }{
				{"branch", "apidiff-20260909t2230-branch"},
				{"main", "apidiff-20260909t2230-main"},
			}
			for _, testCase := range cases {
				if got := HavenSlug(runID, testCase.instance); got != testCase.want {
					t.Errorf("HavenSlug(%q) = %q, want %q", testCase.instance, got, testCase.want)
				}
			}
		})

		t.Run("when each is started, LANGWATCH_SLUG names it and the run is in agent mode", func(t *testing.T) {
			fake := &fakeHaven{readySlugs: map[string]int{
				"apidiff-20260909t2230-branch": 6560,
				"apidiff-20260909t2230-main":   6660,
			}}
			state := havenState(fake, time.Minute)
			if err := state.bootThroughHaven(context.Background(), bothInstances()); err != nil {
				t.Fatalf("bootThroughHaven: %v", err)
			}
			ups := map[string]commandSpec{}
			for _, spec := range fake.commands {
				if len(spec.args) > 0 && spec.args[0] == "up" {
					ups[slugFromEnv(spec.env)] = spec
				}
			}
			for _, slug := range []string{"apidiff-20260909t2230-branch", "apidiff-20260909t2230-main"} {
				spec, ok := ups[slug]
				if !ok {
					t.Fatalf("no up carried LANGWATCH_SLUG=%s; ups were %v", slug, ups)
				}
				if got := argv(spec); got != "haven up --agent --detach" {
					t.Errorf("%s ran %q, want the agent-mode non-attached up", slug, got)
				}
			}
			if ups["apidiff-20260909t2230-branch"].dir != "/repos/langwatch" {
				t.Errorf("the branch stack must come up in the branch checkout, got %q", ups["apidiff-20260909t2230-branch"].dir)
			}
			if ups["apidiff-20260909t2230-main"].dir != "/repos/langwatch/.apidiff/run/main" {
				t.Errorf("the main stack must come up in the worktree apidiff added, got %q", ups["apidiff-20260909t2230-main"].dir)
			}
		})
	})
}

// slugFromEnv reads LANGWATCH_SLUG out of a composed environment.
func slugFromEnv(env []string) string {
	for _, entry := range env {
		if name, value, _ := strings.Cut(entry, "="); name == "LANGWATCH_SLUG" {
			return value
		}
	}
	return ""
}

// @scenario "A slug never collides with a developer's stack"
func TestASlugNeverCollidesWithADevelopersStack(t *testing.T) {
	t.Run("given a registered stack whose slug is feat-strict-feature-layout-v0", func(t *testing.T) {
		// haven derives a worktree's slug from its directory name or its
		// branch. Neither ever produces the apidiff prefix, so the check is
		// that our slugs carry it and that a slug haven derived does not.
		derived := []string{
			domain.SlugFromBranch("feat/strict-feature-layout-v0"),
			domain.DeriveSlug("/repos/worktrees/portless", nil),
			domain.DeriveSlug("/repos/langwatch", nil),
			domain.SlugFromBranch("main"),
		}
		t.Run("when an instance slug is derived, it is prefixed and shares no name", func(t *testing.T) {
			for _, instance := range []string{"branch", "main"} {
				slug := HavenSlug("20260909t2230", instance)
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
						t.Errorf("worktree-derived slug %q took the apidiff prefix", other)
					}
				}
			}
		})
	})
}

// @scenario "Redis, Postgres and ClickHouse isolation come from haven"
func TestDatastoreIsolationComesFromHaven(t *testing.T) {
	datastoreKeys := []string{"DATABASE_URL", "CLICKHOUSE_URL", "REDIS_URL", "REDIS_DB_INDEX"}

	t.Run("given an instance is planned", func(t *testing.T) {
		t.Run("when its haven commands are composed, no datastore address is one of ours", func(t *testing.T) {
			env := havenEnv([]string{
				"HOME=/home/user",
				"DATABASE_URL=postgres://real:secret@127.0.0.1:5432/lw_feat_x",
				"CLICKHOUSE_URL=http://127.0.0.1:8123/lw_feat_x",
				"REDIS_URL=redis://127.0.0.1:6379",
				"REDIS_DB_INDEX=13",
			}, "apidiff-20260909t2230-branch")
			joined := strings.Join(env, "\n")
			for _, key := range datastoreKeys {
				if strings.Contains(joined, key+"=") {
					t.Errorf("%s must not reach haven from apidiff:\n%s", key, joined)
				}
			}
			for _, want := range []string{
				"HOME=/home/user",
				"LANGWATCH_SLUG=apidiff-20260909t2230-branch",
				"LANGWATCH_INSTANCE_ADMIN_API_KEY=" + throwawayInstanceAdminKey,
			} {
				if !strings.Contains(joined, want) {
					t.Errorf("env missing %q:\n%s", want, joined)
				}
			}
		})

		t.Run("when the layout is prepared, no Redis logical database is picked", func(t *testing.T) {
			state := &bootState{cfg: BootConfig{UseHaven: true, BranchDir: t.TempDir(), WorkRoot: t.TempDir()}, stderr: io.Discard}
			if err := state.prepareLayout(); err != nil {
				t.Fatalf("prepareLayout: %v", err)
			}
			if state.infra.branchRedis != 0 || state.infra.mainRedis != 0 {
				t.Errorf("redis indices %d/%d were derived; haven allocates them", state.infra.branchRedis, state.infra.mainRedis)
			}
		})

		t.Run("when both stacks boot, no database is created and no migration is run", func(t *testing.T) {
			fake := &fakeHaven{readySlugs: map[string]int{
				"apidiff-20260909t2230-branch": 6560,
				"apidiff-20260909t2230-main":   6660,
			}}
			state := havenState(fake, time.Minute)
			if err := state.bootThroughHaven(context.Background(), bothInstances()); err != nil {
				t.Fatalf("bootThroughHaven: %v", err)
			}
			for _, forbidden := range []string{"psql", "docker", "pnpm"} {
				if fake.ran(forbidden) {
					t.Errorf("the haven path ran %q; migrating, seeding and provisioning are haven's", forbidden)
				}
			}
			for _, spec := range fake.commands {
				if spec.name != havenCommand {
					t.Errorf("unexpected command %q on the haven path", argv(spec))
				}
			}
		})
	})
}

// @scenario "Teardown names its own two slugs"
func TestTeardownNamesItsOwnTwoSlugs(t *testing.T) {
	t.Run("given both instances are up", func(t *testing.T) {
		fake := &fakeHaven{readySlugs: map[string]int{
			"apidiff-20260909t2230-branch": 6560,
			"apidiff-20260909t2230-main":   6660,
		}}
		state := havenState(fake, time.Minute)
		if err := state.bootThroughHaven(context.Background(), bothInstances()); err != nil {
			t.Fatalf("bootThroughHaven: %v", err)
		}

		t.Run("when the run tears down, exactly the two apidiff slugs are destroyed", func(t *testing.T) {
			before := len(fake.commands)
			state.teardown()
			var destroys []string
			for _, spec := range fake.commands[before:] {
				if len(spec.args) > 0 && spec.args[0] == "destroy" {
					destroys = append(destroys, argv(spec))
					continue
				}
				t.Errorf("teardown also ran %q; it may only destroy what it started", argv(spec))
			}
			want := []string{
				"haven destroy apidiff-20260909t2230-branch --agent --yes",
				"haven destroy apidiff-20260909t2230-main --agent --yes",
			}
			if strings.Join(destroys, "\n") != strings.Join(want, "\n") {
				t.Errorf("teardown ran\n%s\nwant\n%s", strings.Join(destroys, "\n"), strings.Join(want, "\n"))
			}
		})
	})
}

// @scenario "A failed boot still tears down only its own slugs"
func TestAFailedBootTearsDownOnlyItsOwnSlugs(t *testing.T) {
	t.Run("given the main instance never became ready within the boot timeout", func(t *testing.T) {
		fake := &fakeHaven{
			readySlugs: map[string]int{"apidiff-20260909t2230-branch": 6560},
			backendLog: "line one\nEACCES: permission denied, open '/repos/.../server.mts'\n",
		}
		state := havenState(fake, 10*time.Millisecond)
		err := state.bootThroughHaven(context.Background(), bothInstances())
		if err == nil {
			t.Fatal("a stack that never becomes ready must fail the boot")
		}

		t.Run("when the run gives up, the failure names the slug and the backend log", func(t *testing.T) {
			for _, want := range []string{"apidiff-20260909t2230-main", "EACCES: permission denied"} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("failure %q must name %q", err.Error(), want)
				}
			}
		})

		t.Run("when the run gives up, the branch instance's slug is destroyed too", func(t *testing.T) {
			before := len(fake.commands)
			state.teardown()
			var destroyed []string
			for _, spec := range fake.commands[before:] {
				if len(spec.args) > 1 && spec.args[0] == "destroy" {
					destroyed = append(destroyed, spec.args[1])
				}
			}
			want := []string{"apidiff-20260909t2230-branch", "apidiff-20260909t2230-main"}
			if strings.Join(destroyed, ",") != strings.Join(want, ",") {
				t.Errorf("destroyed %v, want %v", destroyed, want)
			}
		})
	})
}

// @scenario "The instance URL is the stack's API address"
func TestTheInstanceURLIsTheStacksAPIAddress(t *testing.T) {
	t.Run("given haven status reports the branch stack", func(t *testing.T) {
		fake := &fakeHaven{readySlugs: map[string]int{
			"apidiff-20260909t2230-branch": 6560,
			"apidiff-20260909t2230-main":   6660,
		}}
		state := havenState(fake, time.Minute)
		booted := bothInstances()
		if err := state.bootThroughHaven(context.Background(), booted); err != nil {
			t.Fatalf("bootThroughHaven: %v", err)
		}

		t.Run("when the instance is addressed, it is the API address haven allocated", func(t *testing.T) {
			cases := []struct{ name, got, want string }{
				{"branch", booted.A.URL, "http://127.0.0.1:6560"},
				{"main", booted.B.URL, "http://127.0.0.1:6660"},
			}
			for _, testCase := range cases {
				if testCase.got != testCase.want {
					t.Errorf("%s URL = %q, want %q", testCase.name, testCase.got, testCase.want)
				}
			}
			// The /api prefix every probed path carries is served there: that
			// is the same address the spec fetch and the health probe use.
			if !strings.HasPrefix(SpecPath, "/api/") || !strings.HasPrefix(healthPath, "/api/") {
				t.Errorf("the probed paths must carry the /api prefix, got %q and %q", SpecPath, healthPath)
			}
		})

		t.Run("when the instance is addressed, apidiff allocated no port of its own", func(t *testing.T) {
			for _, instance := range []Instance{booted.A, booted.B} {
				if instance.Port != 0 {
					t.Errorf("%s holds apidiff-allocated port %d; haven allocates the ports", instance.Name, instance.Port)
				}
			}
		})
	})
}

// @scenario "Ready means haven reports the backend lane healthy"
func TestReadyMeansTheBackendLaneIsHealthy(t *testing.T) {
	const slug = "apidiff-20260909t2230-branch"
	ready := func(stack string) havenStatus {
		return havenStatus{Stacks: []havenStackStatus{{
			Slug: slug, APIPort: 6560, Live: true,
			Lanes: []havenLaneStatus{{Name: "ui", Listening: true}, {Name: havenBackendLane, Listening: stack == "up"}},
		}}}
	}
	cases := []struct {
		name   string
		report havenStatus
		want   bool
	}{
		{name: "the backend lane listening is ready", report: ready("up"), want: true},
		{name: "the ui lane alone is not ready", report: ready("down")},
		{name: "a stack whose launcher is dead is not ready", report: havenStatus{Stacks: []havenStackStatus{{
			Slug: slug, APIPort: 6560, Lanes: []havenLaneStatus{{Name: havenBackendLane, Listening: true}},
		}}}},
		{name: "a stack with no API port is not ready", report: havenStatus{Stacks: []havenStackStatus{{
			Slug: slug, Live: true, Lanes: []havenLaneStatus{{Name: havenBackendLane, Listening: true}},
		}}}},
		{name: "another stack being ready says nothing about ours", report: havenStatus{Stacks: []havenStackStatus{{
			Slug: "feat-strict-feature-layout-v0", APIPort: 6560, Live: true,
			Lanes: []havenLaneStatus{{Name: havenBackendLane, Listening: true}},
		}}}},
		{name: "no stack at all is not ready"},
	}
	for _, testCase := range cases {
		t.Run("when "+testCase.name, func(t *testing.T) {
			_, got := havenStackReady(testCase.report, slug)
			if got != testCase.want {
				t.Errorf("havenStackReady = %v, want %v", got, testCase.want)
			}
		})
	}

	t.Run("when the run waits, it polls haven status --json", func(t *testing.T) {
		fake := &fakeHaven{readySlugs: map[string]int{slug: 6560}}
		state := havenState(fake, time.Minute)
		instance := Instance{Name: "branch", Dir: "/repos/langwatch"}
		if err := state.havenWaitReady(context.Background(), &instance); err != nil {
			t.Fatalf("havenWaitReady: %v", err)
		}
		if got := argv(fake.commands[0]); got != "haven status --agent --json" {
			t.Errorf("readiness asked %q, want the machine-readable status", got)
		}
	})

	t.Run("when the run probes, the credentials are the ones haven's seed wrote", func(t *testing.T) {
		if DefaultProjectKey != domain.DefaultLocalAPIKey {
			t.Errorf("project key %q, want haven's seeded %q", DefaultProjectKey, domain.DefaultLocalAPIKey)
		}
		if DefaultOrgKey != domain.DefaultPrivateAccessToken {
			t.Errorf("org key %q, want haven's seeded %q", DefaultOrgKey, domain.DefaultPrivateAccessToken)
		}
	})
}

// @scenario "A monolith base is ready when its app lane is healthy"
func TestAMonolithStackIsReadyWhenItsAppLaneIsHealthy(t *testing.T) {
	const slug = "apidiff-20260909t2230-main"
	appURL := "https://app." + slug + ".langwatch.localhost"

	t.Run("given haven status reports the stack as the monolith layout", func(t *testing.T) {
		report := havenStatus{Stacks: []havenStackStatus{{
			Slug: slug, Live: true, Layout: domain.LayoutMonolith,
			Lanes:    []havenLaneStatus{{Name: havenrun.AppService, Listening: true}},
			Services: []havenrun.ServiceItem{{Name: havenrun.AppService, URL: appURL}},
		}}}

		t.Run("when the instance is addressed, it is ready at the app hostname", func(t *testing.T) {
			url, ready := havenStackReady(report, slug)
			if !ready {
				t.Fatal("a monolith stack whose app lane is listening must be ready")
			}
			if url != appURL {
				t.Errorf("url = %q, want the routed app hostname %q", url, appURL)
			}
		})
	})

	t.Run("given the app lane is not listening", func(t *testing.T) {
		report := havenStatus{Stacks: []havenStackStatus{{
			Slug: slug, Live: true, Layout: domain.LayoutMonolith,
			Lanes: []havenLaneStatus{{Name: havenrun.AppService, Listening: false}},
		}}}
		t.Run("when the instance is addressed, it is not ready", func(t *testing.T) {
			if _, ready := havenStackReady(report, slug); ready {
				t.Error("a monolith stack whose app lane is down must not be ready")
			}
		})
	})
}

// @scenario "A monolith base's failure tail reads the app lane"
func TestAMonolithBasesFailureTailReadsTheAppLane(t *testing.T) {
	t.Run("given the main instance is the monolith layout", func(t *testing.T) {
		fake := &fakeHaven{backendLog: "line one\nEACCES: permission denied, open '/repos/.../server.mts'\n"}
		state := havenState(fake, time.Minute)
		plan := havenPlan{instance: "main", slug: "apidiff-20260909t2230-main", dir: "/repos/langwatch/.apidiff/run/main"}
		instance := Instance{Name: "main", Dir: plan.dir, Profile: bootProfile{name: profileMonolith}}

		t.Run("when the run gives up, the tail comes from the app lane's own log", func(t *testing.T) {
			got := state.havenBackendLog(context.Background(), plan, instance)
			if !strings.Contains(got, "EACCES: permission denied") {
				t.Errorf("log tail = %q, want the fake log content", got)
			}
			var logCmd commandSpec
			for _, spec := range fake.commands {
				if len(spec.args) > 0 && spec.args[0] == "logs" {
					logCmd = spec
				}
			}
			if got := argv(logCmd); got != "haven logs app --agent --stack apidiff-20260909t2230-main" {
				t.Errorf("logs command = %q, want the app lane", got)
			}
		})
	})

	t.Run("given the instance is the modular layout", func(t *testing.T) {
		fake := &fakeHaven{backendLog: "modular log"}
		state := havenState(fake, time.Minute)
		plan := havenPlan{instance: "branch", slug: "apidiff-20260909t2230-branch", dir: "/repos/langwatch"}
		instance := Instance{Name: "branch", Dir: plan.dir, Profile: bootProfile{name: profileModular}}

		t.Run("when the run gives up, the tail still comes from the backend lane", func(t *testing.T) {
			state.havenBackendLog(context.Background(), plan, instance)
			var logCmd commandSpec
			for _, spec := range fake.commands {
				if len(spec.args) > 0 && spec.args[0] == "logs" {
					logCmd = spec
				}
			}
			if got := argv(logCmd); got != "haven logs backend --agent --stack apidiff-20260909t2230-branch" {
				t.Errorf("logs command = %q, want the backend lane", got)
			}
		})
	})
}

// @scenario "haven is the default when present"
// @scenario "The compose and external-infra paths are opt-in"
func TestHavenIsTheDefaultAndTheOtherPathsAreOptIn(t *testing.T) {
	cases := []struct {
		name                              string
		onPath, noHaven, external, wanted bool
	}{
		{name: "haven on PATH with no infra flags boots through haven", onPath: true, wanted: true},
		{name: "-no-haven boots the old way", onPath: true, noHaven: true},
		{name: "a machine with no haven boots the old way"},
		{name: "the three external servers are an explicit choice", onPath: true, external: true},
		{name: "-no-haven on a machine without haven is still the old way", noHaven: true},
	}
	for _, testCase := range cases {
		t.Run("when "+testCase.name, func(t *testing.T) {
			if got := havenSelected(testCase.onPath, testCase.noHaven, testCase.external); got != testCase.wanted {
				t.Errorf("havenSelected(onPath=%v, noHaven=%v, external=%v) = %v, want %v",
					testCase.onPath, testCase.noHaven, testCase.external, got, testCase.wanted)
			}
		})
	}

	t.Run("when -env-file is given together with haven, the run refuses and names both", func(t *testing.T) {
		if !havenOnPath() {
			t.Skip("haven is not installed on this machine; the exclusion is unreachable here")
		}
		stderr := &strings.Builder{}
		// The refusal is a parse-time verdict: with haven selected the run must
		// never reach a boot, so nothing here creates a worktree or installs.
		code := Run([]string{"run", "-env-file", "/repos/langwatch/.env", "-branch-dir", t.TempDir()}, io.Discard, stderr)
		if code != exitError {
			t.Errorf("exit code %d, want %d", code, exitError)
		}
		for _, want := range []string{"-env-file", "haven"} {
			if !strings.Contains(stderr.String(), want) {
				t.Errorf("refusal %q must name %q", stderr.String(), want)
			}
		}
	})
}
