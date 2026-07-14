package app

import (
	"context"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type fakeSupervisor struct {
	shells []string
	envs   [][]string
}

func (f *fakeSupervisor) RunOnce(_ context.Context, _, _, shell string, env []string) error {
	f.shells = append(f.shells, shell)
	f.envs = append(f.envs, env)
	return nil
}
func (f *fakeSupervisor) RunOnceBounded(_ context.Context, _, _, shell string, env []string, _ ReapLimits) error {
	f.shells = append(f.shells, shell)
	f.envs = append(f.envs, env)
	return nil
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

func TestSeedPresets(t *testing.T) {
	params := UpParams{ExplicitSlug: "feat-x", WorktreeDir: "/wt/feat-x", LwDir: "/wt/feat-x/langwatch"}

	t.Run("given no preset", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := seedOrchestrator(sup, &fakeStore{}, &fakeSystem{})

		t.Run("when seeding, only the plain seed runs with no preset env", func(t *testing.T) {
			if err := o.Seed(context.Background(), params, ""); err != nil {
				t.Fatalf("Seed: %v", err)
			}
			if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "prisma:seed") {
				t.Errorf("shells = %v, want just prisma:seed", sup.shells)
			}
			if len(sup.envs[0]) != 0 {
				t.Errorf("env = %v, want none", sup.envs[0])
			}
		})
	})

	t.Run("given an unknown preset", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := seedOrchestrator(sup, &fakeStore{}, &fakeSystem{})

		t.Run("when seeding, it fails listing the available presets", func(t *testing.T) {
			err := o.Seed(context.Background(), params, "nosuch")
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
			err := o.Seed(context.Background(), params, "demo")
			if err == nil || !strings.Contains(err.Error(), "not running") {
				t.Fatalf("expected a stack-not-running error, got %v", err)
			}
			if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "prisma:seed") {
				t.Errorf("shells = %v, want just prisma:seed", sup.shells)
			}
			if len(sup.envs[0]) != 1 || sup.envs[0][0] != "HAVEN_SEED_PRESET=demo" {
				t.Errorf("env = %v, want the preset", sup.envs[0])
			}
		})
	})

	t.Run("given the demo preset with a live stack", func(t *testing.T) {
		sup := &fakeSupervisor{}
		store := &fakeStore{stacks: []domain.Stack{{
			Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: 42,
			Services: []domain.Service{{Name: "app", Port: 5560}},
		}}}
		sys := &portSystem{fakeSystem: fakeSystem{alive: map[int]bool{42: true}}, portsUp: map[int]bool{5560: true}}
		o := seedOrchestrator(sup, store, sys)

		t.Run("when seeding, sample traces are ingested through the app's loopback port", func(t *testing.T) {
			if err := o.Seed(context.Background(), params, "demo"); err != nil {
				t.Fatalf("Seed: %v", err)
			}
			if len(sup.shells) != 2 || !strings.Contains(sup.shells[1], "seed:sample-traces") {
				t.Fatalf("shells = %v, want prisma:seed then seed:sample-traces", sup.shells)
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
