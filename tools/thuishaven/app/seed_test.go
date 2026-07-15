package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type fakeSupervisor struct {
	shells []string
	envs   [][]string
	err    error
}

func (f *fakeSupervisor) RunOnce(_ context.Context, _, _, shell string, env []string) error {
	f.shells = append(f.shells, shell)
	f.envs = append(f.envs, env)
	return f.err
}
func (f *fakeSupervisor) RunOnceBounded(_ context.Context, _, _, shell string, env []string, _ ReapLimits) error {
	f.shells = append(f.shells, shell)
	f.envs = append(f.envs, env)
	return f.err
}
func (f *fakeSupervisor) Supervise(context.Context, []Child) {}

type portSystem struct {
	fakeSystem
	portsUp map[int]bool
}

func (p *portSystem) PortInUse(port int) bool { return p.portsUp[port] }

func seedOrchestrator(sup *fakeSupervisor, store *fakeStore, sys System) *Orchestrator {
	return &Orchestrator{
		cfg: Config{Naming: domain.DefaultNaming(""), LocalAPIKey: "sk-lw-local-development-key"},
		sup: sup, store: store, sys: sys,
		log: zap.NewNop(),
	}
}

func liveStackStore() *fakeStore {
	return &fakeStore{stacks: []domain.Stack{{
		Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: 42,
		Services: []domain.Service{{Name: "app", Port: 5560}},
	}}}
}

// @scenario "The default seed is unchanged"
// @scenario "The demo preset needs the stack for its traces"
// @scenario "Unknown presets are rejected with the available choices"
// @scenario "Sample traces without the full demo preset"
func TestSeedPresets(t *testing.T) {
	params := UpParams{ExplicitSlug: "feat-x", WorktreeDir: "/wt/feat-x", LwDir: "/wt/feat-x/langwatch"}

	t.Run("given no preset", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := seedOrchestrator(sup, &fakeStore{}, &fakeSystem{})

		t.Run("when seeding, only the plain seed runs carrying the local API key", func(t *testing.T) {
			if err := o.Seed(context.Background(), params, SeedOptions{Preset: ""}); err != nil {
				t.Fatalf("Seed: %v", err)
			}
			if len(sup.shells) != 1 || len(sup.envs) != 1 {
				t.Fatalf("want exactly one seed run, got shells=%v envs=%v", sup.shells, sup.envs)
			}
			if !strings.Contains(sup.shells[0], "prisma:seed") {
				t.Errorf("shells = %v, want just prisma:seed", sup.shells)
			}
			joined := strings.Join(sup.envs[0], " ")
			if !strings.Contains(joined, "HAVEN_SEED_LANGWATCH_API_KEY=sk-lw-local-development-key") {
				t.Errorf("env = %v, want the local API key", sup.envs[0])
			}
			if strings.Contains(joined, "HAVEN_SEED_PRESET") {
				t.Errorf("env = %v, want no preset", sup.envs[0])
			}
		})
	})

	t.Run("given an unknown preset", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := seedOrchestrator(sup, &fakeStore{}, &fakeSystem{})

		t.Run("when seeding, it fails listing the available presets", func(t *testing.T) {
			err := o.Seed(context.Background(), params, SeedOptions{Preset: "nosuch"})
			if err == nil || !strings.Contains(err.Error(), "demo") {
				t.Fatalf("expected an error listing presets, got %v", err)
			}
			if len(sup.shells) != 0 {
				t.Errorf("nothing should run, got %v", sup.shells)
			}
		})
	})

	t.Run("given the demo preset with the stack not running", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := seedOrchestrator(sup, &fakeStore{}, &fakeSystem{})

		t.Run("when seeding, the seed runs with the preset env but traces are refused", func(t *testing.T) {
			err := o.Seed(context.Background(), params, SeedOptions{Preset: "demo"})
			if err == nil || !strings.Contains(err.Error(), "not running") {
				t.Fatalf("expected a stack-not-running error, got %v", err)
			}
			if len(sup.shells) != 1 || len(sup.envs) != 1 {
				t.Fatalf("want exactly the prisma:seed run, got shells=%v", sup.shells)
			}
			if !strings.Contains(sup.shells[0], "prisma:seed") {
				t.Errorf("shells = %v, want just prisma:seed", sup.shells)
			}
			if !strings.Contains(strings.Join(sup.envs[0], " "), "HAVEN_SEED_PRESET=demo") {
				t.Errorf("env = %v, want the preset", sup.envs[0])
			}
		})
	})

	t.Run("given extra seed options without a preset", func(t *testing.T) {
		t.Run("when seeding with extra env, it reaches the seed child", func(t *testing.T) {
			sup := &fakeSupervisor{}
			o := seedOrchestrator(sup, &fakeStore{}, &fakeSystem{})
			if err := o.Seed(context.Background(), params, SeedOptions{
				ExtraEnv: []string{"HAVEN_SEED_FIRST_MESSAGE=1", "HAVEN_SEED_MODEL_PROVIDERS=0"},
			}); err != nil {
				t.Fatalf("Seed: %v", err)
			}
			joined := strings.Join(sup.envs[0], " ")
			for _, want := range []string{"HAVEN_SEED_FIRST_MESSAGE=1", "HAVEN_SEED_MODEL_PROVIDERS=0"} {
				if !strings.Contains(joined, want) {
					t.Errorf("env = %v, want %s", sup.envs[0], want)
				}
			}
		})

		t.Run("when seeding with traces requested and the stack not running, traces are refused", func(t *testing.T) {
			sup := &fakeSupervisor{}
			o := seedOrchestrator(sup, &fakeStore{}, &fakeSystem{})
			err := o.Seed(context.Background(), params, SeedOptions{ShouldIngestTraces: true})
			if err == nil || !strings.Contains(err.Error(), "not running") {
				t.Fatalf("expected a stack-not-running error, got %v", err)
			}
			// The retry hint must repeat the trace-only command — `--preset demo`
			// would additionally flip the onboarding state.
			if !strings.Contains(err.Error(), "haven seed --traces") {
				t.Errorf("err = %v, want the trace-only retry command", err)
			}
			if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "prisma:seed") {
				t.Errorf("shells = %v, want just prisma:seed", sup.shells)
			}
		})
	})

	t.Run("given the demo preset with a live stack whose app port is not answering", func(t *testing.T) {
		sup := &fakeSupervisor{}
		sys := &portSystem{fakeSystem: fakeSystem{alive: map[int]bool{42: true}}, portsUp: map[int]bool{}}
		o := seedOrchestrator(sup, liveStackStore(), sys)

		t.Run("when seeding, traces are refused and only the plain seed ran", func(t *testing.T) {
			err := o.Seed(context.Background(), params, SeedOptions{Preset: "demo"})
			if err == nil || !strings.Contains(err.Error(), "not answering") {
				t.Fatalf("expected a not-answering refusal, got %v", err)
			}
			if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "prisma:seed") {
				t.Errorf("shells = %v, want just prisma:seed", sup.shells)
			}
		})
	})

	t.Run("given the demo preset with a live stack whose only app service is a baseline fallback", func(t *testing.T) {
		sup := &fakeSupervisor{}
		store := &fakeStore{stacks: []domain.Stack{{
			Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: 42,
			Services: []domain.Service{{Name: "app", Port: 5560, IsFallback: true}},
		}}}
		sys := &portSystem{fakeSystem: fakeSystem{alive: map[int]bool{42: true}}, portsUp: map[int]bool{5560: true}}
		o := seedOrchestrator(sup, store, sys)

		t.Run("when seeding, the fallback app is not a local target so traces are refused", func(t *testing.T) {
			err := o.Seed(context.Background(), params, SeedOptions{Preset: "demo"})
			if err == nil || !strings.Contains(err.Error(), "not answering") {
				t.Fatalf("expected a not-answering refusal, got %v", err)
			}
			if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "prisma:seed") {
				t.Errorf("shells = %v, want just prisma:seed", sup.shells)
			}
		})
	})

	t.Run("given the prisma:seed process fails", func(t *testing.T) {
		sup := &fakeSupervisor{err: errors.New("seed boom")}
		sys := &portSystem{fakeSystem: fakeSystem{alive: map[int]bool{42: true}}, portsUp: map[int]bool{5560: true}}
		o := seedOrchestrator(sup, liveStackStore(), sys)

		t.Run("when seeding the demo preset, the error propagates and traces never run", func(t *testing.T) {
			err := o.Seed(context.Background(), params, SeedOptions{Preset: "demo"})
			if err == nil {
				t.Fatal("expected the seed error to propagate")
			}
			if len(sup.shells) != 1 {
				t.Errorf("want only the failed prisma:seed shell, got %v", sup.shells)
			}
		})
	})

	t.Run("given the demo preset with a live stack", func(t *testing.T) {
		sup := &fakeSupervisor{}
		sys := &portSystem{fakeSystem: fakeSystem{alive: map[int]bool{42: true}}, portsUp: map[int]bool{5560: true}}
		o := seedOrchestrator(sup, liveStackStore(), sys)

		t.Run("when seeding, sample traces are ingested through the app's loopback port", func(t *testing.T) {
			if err := o.Seed(context.Background(), params, SeedOptions{Preset: "demo"}); err != nil {
				t.Fatalf("Seed: %v", err)
			}
			if len(sup.shells) != 2 || len(sup.envs) != 2 {
				t.Fatalf("shells = %v, want prisma:seed then seed:sample-traces", sup.shells)
			}
			if !strings.Contains(sup.shells[1], "seed:sample-traces") {
				t.Fatalf("shells = %v, want seed:sample-traces second", sup.shells)
			}
			joined := strings.Join(sup.envs[1], " ")
			if !strings.Contains(joined, "HAVEN_SEED_ENDPOINT=http://127.0.0.1:5560") {
				t.Errorf("traces env should point at the app's loopback port, got %v", sup.envs[1])
			}
			if !strings.Contains(joined, "HAVEN_SEED_LANGWATCH_API_KEY=sk-lw-local-development-key") {
				t.Errorf("traces env should carry the local ingestion key, got %v", sup.envs[1])
			}
		})
	})
}
