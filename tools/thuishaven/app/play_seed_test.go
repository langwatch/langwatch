package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// playPortSystem hands out distinct ports, unlike fakeSystem's zeros: a sandbox
// that seeds has to address its own app, so the ports have to be real values.
type playPortSystem struct {
	fakeSystem
	next int
}

func (p *playPortSystem) FreePorts(n int) ([]int, error) {
	ports := make([]int, n)
	for i := range ports {
		p.next++
		ports[i] = 6000 + p.next
	}
	return ports, nil
}

type fakeContainer struct{}

func (fakeContainer) Ensure(context.Context) (string, error) { return "unix:///fake.sock", nil }
func (fakeContainer) Profile() string                        { return "fake" }

// playCheckout is a complete-enough checkout for the launcher: a lockfile (so
// the dependency install resolves a workspace root) and the app directory.
func playCheckout(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "pnpm-lock.yaml"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "platform", "app"), 0o750); err != nil {
		t.Fatal(err)
	}
	return dir
}

// playStore records what the launcher registers, so a test can read back the
// sandbox's own ports the way the seed ingest does.
type playStore struct{ fakeStore }

func (s *playStore) SaveStack(st domain.Stack) error {
	s.stacks = append(s.stacks, st)
	return nil
}

func playOrchestrator(sup *fakeSupervisor) *Orchestrator {
	return &Orchestrator{
		cfg: Config{
			Naming:      domain.DefaultNaming(""),
			LocalAPIKey: "sk-lw-local-development-key",
		},
		sup: sup, store: &playStore{}, sys: &playPortSystem{}, proxy: &fakeProxy{},
		container: fakeContainer{}, log: zap.NewNop(),
	}
}

// launchPlay runs the sandbox launcher to completion. Supervise is a no-op in
// the fake, so this returns once provisioning is done and the seed ingest lane
// has finished — PlayLaunch waits for it rather than leaving it running into
// teardown.
func launchPlay(t *testing.T, sup *fakeSupervisor, preset string) *Orchestrator {
	t.Helper()
	o := playOrchestrator(sup)
	checkout := playCheckout(t)
	sandbox := PlaySandbox{
		Number: 4913, Checkout: checkout,
		LwDir: filepath.Join(checkout, "platform", "app"), Preset: preset,
	}
	if err := o.PlayLaunch(context.Background(), sandbox); err != nil {
		t.Fatalf("PlayLaunch(%q): %v", preset, err)
	}
	return o
}

// shellsMatching are the run-once lanes whose command contains want, in order.
func shellsMatching(sup *fakeSupervisor, want string) []string {
	var out []string
	for _, shell := range sup.shells {
		if strings.Contains(shell, want) {
			out = append(out, shell)
		}
	}
	return out
}

// envForShell is the environment the lane running want was given.
func envForShell(t *testing.T, sup *fakeSupervisor, want string) string {
	t.Helper()
	for i, shell := range sup.shells {
		if strings.Contains(shell, want) {
			return strings.Join(sup.envs[i], " ")
		}
	}
	t.Fatalf("no lane ran %q — shells were %v", want, sup.shells)
	return ""
}

// @scenario "A sandbox can be seeded with a data preset"
func TestPlaySeedsFromTheSharedPresetRegistry(t *testing.T) {
	t.Run("given a preset", func(t *testing.T) {
		t.Run("when the sandbox launches, the seed carries the preset's switches", func(t *testing.T) {
			sup := &fakeSupervisor{}
			launchPlay(t, sup, "demo")
			if env := envForShell(t, sup, "prisma:seed"); !strings.Contains(env, "HAVEN_SEED_PRESET=demo") {
				t.Errorf("seed env = %q, want the demo preset's switches", env)
			}
		})
	})

	t.Run("given no preset", func(t *testing.T) {
		t.Run("when the sandbox launches, the identity seed is unchanged", func(t *testing.T) {
			sup := &fakeSupervisor{}
			launchPlay(t, sup, "")
			if env := envForShell(t, sup, "prisma:seed"); strings.Contains(env, "HAVEN_SEED_PRESET") {
				t.Errorf("seed env = %q, want no preset switches without --seed", env)
			}
		})
	})

	t.Run("given a name that is not in the registry", func(t *testing.T) {
		t.Run("when the sandbox launches, it fails naming the presets", func(t *testing.T) {
			err := ValidateSeedPreset("nosuch")
			if err == nil {
				t.Fatal("ValidateSeedPreset accepted a preset that does not exist")
			}
			for _, name := range SeedPresetNames() {
				if !strings.Contains(err.Error(), name) {
					t.Errorf("error %q does not offer %q", err, name)
				}
				if err := ValidateSeedPreset(name); err != nil {
					t.Errorf("ValidateSeedPreset(%q) = %v, want the shared registry to accept it", name, err)
				}
			}
			if err := ValidateSeedPreset(""); err != nil {
				t.Errorf("ValidateSeedPreset(\"\") = %v, want the plain identity seed", err)
			}
		})
	})
}

// @scenario "Preset data is ingested once the sandbox is serving"
func TestPlaySeedIngestWaitsForTheSandboxsOwnApp(t *testing.T) {
	sup := &fakeSupervisor{}
	o := launchPlay(t, sup, "demo")

	stack, ok := o.stackBySlug(PlaySlug(4913))
	if !ok {
		t.Fatal("the sandbox registered no stack")
	}
	appPort := playAppPort(stack)
	if appPort == 0 {
		t.Fatal("the sandbox stack has no app port")
	}

	t.Run("when the ingest runs, it waits for that app's health endpoint first", func(t *testing.T) {
		want := "http://127.0.0.1:" + strconv.Itoa(appPort) + "/api/health"
		if len(sup.waited) != 1 || sup.waited[0] != want {
			t.Fatalf("waited on %v, want exactly %q", sup.waited, want)
		}
	})

	t.Run("when the ingest runs, every step targets the sandbox on loopback", func(t *testing.T) {
		steps := shellsMatching(sup, "pnpm run seed:")
		if len(steps) != len(seedPresets["demo"].ingest) {
			t.Fatalf("ingest steps = %v, want the demo preset's %v", steps, seedPresets["demo"].ingest)
		}
		for i, script := range seedPresets["demo"].ingest {
			if !strings.Contains(steps[i], script) {
				t.Errorf("ingest step %d = %q, want %q — order is the registry's", i, steps[i], script)
			}
		}
		env := envForShell(t, sup, "seed:sample-traces")
		if !strings.Contains(env, "HAVEN_SEED_ENDPOINT=http://127.0.0.1:"+strconv.Itoa(appPort)) {
			t.Errorf("ingest env = %q, want the sandbox's own loopback app", env)
		}
		if !strings.Contains(env, "HAVEN_SEED_LANGWATCH_API_KEY=sk-lw-local-development-key") {
			t.Errorf("ingest env = %q, want the local ingestion key", env)
		}
	})
}

// @scenario "Presets with no ingest never wait for the app"
func TestPlaySeedWithoutIngestNeverWaits(t *testing.T) {
	for _, preset := range []string{"", "post-onboarding"} {
		sup := &fakeSupervisor{}
		launchPlay(t, sup, preset)
		if len(sup.waited) != 0 {
			t.Errorf("preset %q waited on %v, want no wait — it loads no data", preset, sup.waited)
		}
		if steps := shellsMatching(sup, "pnpm run seed:"); len(steps) != 0 {
			t.Errorf("preset %q ran %v, want no ingest step", preset, steps)
		}
	}
}

// The sandbox is the point; its sample data is a convenience. A PR that breaks
// the collector is exactly a PR someone wants to watch running.
// @scenario "A failed seed never takes the sandbox down"
func TestPlaySeedFailureLeavesTheSandboxRunning(t *testing.T) {
	sup := &fakeSupervisor{errOn: "seed:sample-traces", err: errors.New("collector said no")}
	launchPlay(t, sup, "demo") // launchPlay fails the test if the launch returns an error

	t.Run("when a step fails, the steps after it are abandoned", func(t *testing.T) {
		steps := shellsMatching(sup, "pnpm run seed:")
		if len(steps) != 2 {
			t.Fatalf("ingest steps = %v, want the retention pin then the failing traces step", steps)
		}
	})

	t.Run("when a step fails, the retry names this sandbox's own stack", func(t *testing.T) {
		msg := PlaySeedFailure(PlaySlug(4913), "demo", "seed:sample-traces")
		for _, want := range []string{"seed:sample-traces", "still running", "LANGWATCH_SLUG=play-4913", "haven db seed demo"} {
			if !strings.Contains(msg, want) {
				t.Errorf("failure message %q is missing %q", msg, want)
			}
		}
	})
}
