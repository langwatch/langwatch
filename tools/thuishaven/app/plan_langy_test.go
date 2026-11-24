package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestLangyContainerShell(t *testing.T) {
	t.Run("given the sandboxed tier (UID sandbox on)", func(t *testing.T) {
		sh := langyContainerShell(langyContainerOpts{
			Slug: "happy-tiger", Port: 49624, Secret: "sekret",
		})
		t.Run("publishes the manager port to host loopback", func(t *testing.T) {
			if !strings.Contains(sh, "'-p' '127.0.0.1:49624:49624'") {
				t.Fatalf("missing loopback publish in: %s", sh)
			}
		})
		t.Run("sets PORT, ENVIRONMENT, structured logging and the internal secret", func(t *testing.T) {
			for _, want := range []string{"'PORT=49624'", "'ENVIRONMENT=local'", "'LOG_FORMAT=json'", "'LANGY_INTERNAL_SECRET=sekret'"} {
				if !strings.Contains(sh, want) {
					t.Fatalf("missing %s in: %s", want, sh)
				}
			}
		})
		t.Run("strictly bounds local worker and container resources", func(t *testing.T) {
			for _, want := range []string{
				"'--memory' '1792m'",
				"'--memory-swap' '1792m'",
				"'--cpus' '2'",
				"'--pids-limit' '256'",
				"'LANGY_MAX_WORKERS=2'",
				"'LANGY_WORKER_IDLE_MS=15000'",
				"'LANGY_REAPER_INTERVAL_MS=2000'",
			} {
				if !strings.Contains(sh, want) {
					t.Fatalf("missing strict local setting %s in: %s", want, sh)
				}
			}
		})
		t.Run("does NOT disable the UID sandbox", func(t *testing.T) {
			if strings.Contains(sh, "LANGY_UNSAFE_DEV_DISABLE_ISOLATION") {
				t.Fatalf("sandboxed tier must keep the UID sandbox on: %s", sh)
			}
		})
		t.Run("force-removes a stale container then execs docker run", func(t *testing.T) {
			if !strings.Contains(sh, "docker rm -f 'langyagent-happy-tiger'") {
				t.Fatalf("missing stale-container cleanup: %s", sh)
			}
			if !strings.Contains(sh, "exec 'docker' 'run' '--rm'") {
				t.Fatalf("must exec docker run so SIGTERM reaches it: %s", sh)
			}
		})
		t.Run("never pulls from a registry", func(t *testing.T) {
			if !strings.Contains(sh, "'--pull' 'never'") {
				t.Fatalf("must pin --pull never: %s", sh)
			}
		})
		t.Run("runs the default local image", func(t *testing.T) {
			if !strings.Contains(sh, "'"+langyImage+"'") {
				t.Fatalf("missing image %s in: %s", langyImage, sh)
			}
		})
	})

	t.Run("given the container-unsafe tier", func(t *testing.T) {
		sh := langyContainerShell(langyContainerOpts{
			Slug: "brave-otter", Port: 5000, Secret: "s", DisableUIDSandbox: true,
		})
		t.Run("disables the UID sandbox inside the container", func(t *testing.T) {
			if !strings.Contains(sh, "'LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true'") {
				t.Fatalf("container-unsafe tier must disable the UID sandbox: %s", sh)
			}
		})
	})

	t.Run("given the observability stack is up (OTLP port set)", func(t *testing.T) {
		sh := langyContainerShell(langyContainerOpts{
			Slug: "keen-lynx", Port: 5000, Secret: "s", ObservabilityOTLPPort: 4318,
		})
		t.Run("dual-exports to the collector at host.docker.internal, not loopback", func(t *testing.T) {
			if !strings.Contains(sh, "'OTEL_DEBUG_COLLECTOR_ENDPOINT=http://host.docker.internal:4318'") {
				t.Fatalf("container must reach the collector via host.docker.internal: %s", sh)
			}
			if strings.Contains(sh, "OTEL_DEBUG_COLLECTOR_ENDPOINT=http://127.0.0.1") {
				t.Fatalf("127.0.0.1 inside the container is the container itself, not the host: %s", sh)
			}
		})
		t.Run("tags the telemetry with the worktree slug", func(t *testing.T) {
			if !strings.Contains(sh, "'OTEL_RESOURCE_ATTRIBUTES=langwatch.worktree=keen-lynx'") {
				t.Fatalf("missing worktree resource attribute: %s", sh)
			}
		})
	})

	t.Run("given the observability stack is down (OTLP port zero)", func(t *testing.T) {
		sh := langyContainerShell(langyContainerOpts{Slug: "shy-vole", Port: 5000, Secret: "s"})
		t.Run("adds no OTel env — a prod-shaped no-op", func(t *testing.T) {
			if strings.Contains(sh, "OTEL_DEBUG_COLLECTOR_ENDPOINT") {
				t.Fatalf("must not wire the debug collector when the stack is down: %s", sh)
			}
			if strings.Contains(sh, "OTEL_RESOURCE_ATTRIBUTES") {
				t.Fatalf("must not stamp resource attributes when the stack is down: %s", sh)
			}
		})
	})
}

func TestLangyImageEnsureShell(t *testing.T) {
	t.Run("given no force rebuild", func(t *testing.T) {
		sh := langyImageEnsureShell("langyagent:dev", false, "")
		t.Run("builds only when the image is absent", func(t *testing.T) {
			if !strings.Contains(sh, "docker image inspect 'langyagent:dev' >/dev/null 2>&1 ||") {
				t.Fatalf("expected presence-gated build, got: %s", sh)
			}
			if !strings.Contains(sh, "docker build -f infra/docker/Dockerfile.langyagent -t 'langyagent:dev' .") {
				t.Fatalf("missing build command: %s", sh)
			}
		})
	})
	t.Run("given a forced rebuild", func(t *testing.T) {
		sh := langyImageEnsureShell("langyagent:dev", true, "")
		t.Run("always rebuilds, unconditionally", func(t *testing.T) {
			if strings.Contains(sh, "docker image inspect") {
				t.Fatalf("forced rebuild must not gate on presence: %s", sh)
			}
			if !strings.HasPrefix(sh, "docker build -f infra/docker/Dockerfile.langyagent") {
				t.Fatalf("expected an unconditional build: %s", sh)
			}
		})
	})
}

// The local idle timeout is a RAM decision, and overriding it is what makes the
// warm path testable locally at all — so the override, and its fallbacks, are
// worth pinning. A bad value must never take the stack down with it.
func TestLangyWorkerIdleMS(t *testing.T) {
	t.Run("defaults to the given default", func(t *testing.T) {
		t.Setenv(langyWorkerIdleEnv, "")
		if got := langyWorkerIdleMS(localLangyWorkerIdleMS); got != localLangyWorkerIdleMS {
			t.Fatalf("want %d, got %d", localLangyWorkerIdleMS, got)
		}
		if got := langyWorkerIdleMS(localLangyWorkerIdleHostMS); got != localLangyWorkerIdleHostMS {
			t.Fatalf("want %d, got %d", localLangyWorkerIdleHostMS, got)
		}
	})

	t.Run("honours a developer override regardless of default", func(t *testing.T) {
		t.Setenv(langyWorkerIdleEnv, "300000")
		if got := langyWorkerIdleMS(localLangyWorkerIdleMS); got != 300_000 {
			t.Fatalf("want 300000, got %d", got)
		}
		if got := langyWorkerIdleMS(localLangyWorkerIdleHostMS); got != 300_000 {
			t.Fatalf("want 300000, got %d", got)
		}
	})

	t.Run("falls back to the given default rather than failing on a bad value", func(t *testing.T) {
		for _, bad := range []string{"soon", "-1", "0"} {
			t.Setenv(langyWorkerIdleEnv, bad)
			if got := langyWorkerIdleMS(localLangyWorkerIdleMS); got != localLangyWorkerIdleMS {
				t.Fatalf("%q: want fallback %d, got %d", bad, localLangyWorkerIdleMS, got)
			}
		}
	})
}

func TestLangyChildHostTier(t *testing.T) {
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}}
	st := domain.Stack{Slug: "demo", LangyTier: domain.LangyTierHostUnsafe}
	repo := t.TempDir()
	child := o.langyChild(st, PlanOptions{RepoRoot: repo}, nil, 4123, "")

	// @scenario "Langy on the host runs this checkout's langwatch CLI"
	t.Run("puts the checkout's CLI shims first on PATH, after the login profile", func(t *testing.T) {
		want := "export PATH=" + shQuote(langyCLIBinDir(repo)) + `:"$PATH"; make `
		if !strings.HasPrefix(child.Shell, want) {
			t.Fatalf("host tier shell does not lead with the CLI shims: %q", child.Shell)
		}
	})

	t.Run("accepts the manager's loopback relay over cleartext", func(t *testing.T) {
		if !slices.Contains(child.Env, "LANGY_EGRESS_REQUIRE_TLS=false") {
			t.Fatalf("host tier env lacks LANGY_EGRESS_REQUIRE_TLS=false: %v", child.Env)
		}
	})
}

func TestEnsureLangyWorkerBinary(t *testing.T) {
	bunDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(bunDir, "bun"), []byte("#!/bin/sh\n"), 0o700); err != nil { //nolint:gosec // the fixture needs the exec bit
		t.Fatal(err)
	}
	t.Setenv("PATH", bunDir)
	run := func(t *testing.T, sup *fakeSupervisor, withBinary bool, tier domain.LangyTier) PlanOptions {
		t.Helper()
		repo := t.TempDir()
		if withBinary {
			path := langyWorkerBinaryPath(repo)
			if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(path, 0o700); err != nil { //nolint:gosec // the fixture needs the exec bit
				t.Fatal(err)
			}
		}
		o := &Orchestrator{sup: sup, sys: &fakeSystem{}, log: zap.NewNop()}
		st := domain.Stack{Slug: "demo", WorktreeDir: t.TempDir(), LangyTier: tier}
		opts := PlanOptions{RepoRoot: repo, Selection: domain.Selection{Langy: true}}
		o.ensureLangyWorkerBinary(context.Background(), st, &opts)
		return opts
	}

	t.Run("builds a missing binary on the host tier and keeps Langy", func(t *testing.T) {
		sup := &fakeSupervisor{}
		opts := run(t, sup, false, domain.LangyTierHostUnsafe)
		if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "@langwatch/langyworker:build:binary") {
			t.Fatalf("expected one build, got %v", sup.shells)
		}
		if !opts.Selection.Langy {
			t.Fatal("Langy was deselected after a good build")
		}
	})

	t.Run("deselects Langy when the build fails", func(t *testing.T) {
		sup := &fakeSupervisor{err: errors.New("exit 1")}
		if run(t, sup, false, domain.LangyTierHostUnsafe).Selection.Langy {
			t.Fatal("Langy still selected after a failed build")
		}
	})

	// @scenario "A Langy that cannot build for want of bun says how to fix it"
	t.Run("skips the build and deselects Langy when bun is missing", func(t *testing.T) {
		t.Setenv("PATH", t.TempDir())
		sup := &fakeSupervisor{}
		if run(t, sup, false, domain.LangyTierHostUnsafe).Selection.Langy {
			t.Fatal("Langy still selected with no bun to build its worker")
		}
		if len(sup.shells) != 0 {
			t.Fatalf("a build ran with no bun: %v", sup.shells)
		}
	})

	t.Run("does nothing when the binary exists or the tier is a container", func(t *testing.T) {
		sup := &fakeSupervisor{}
		run(t, sup, true, domain.LangyTierHostUnsafe)
		run(t, sup, false, domain.LangyTierSandboxed)
		if len(sup.shells) != 0 {
			t.Fatalf("unexpected build: %v", sup.shells)
		}
	})
}

// @scenario "Langy on the host runs this checkout's langwatch CLI"
func TestEnsureLangyCLI(t *testing.T) {
	// The checkout's CLI before haven runs: absent, built by haven with the
	// native render, or built some other way (no native stamp).
	const (
		missing   = "missing"
		native    = "native"
		unstamped = "unstamped"
	)
	run := func(t *testing.T, sup *fakeSupervisor, cli string, tier domain.LangyTier) string {
		t.Helper()
		repo := t.TempDir()
		if cli != missing {
			entry := langyCLIEntry(repo)
			if err := os.MkdirAll(filepath.Dir(entry), 0o750); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(entry, []byte("#!/usr/bin/env node\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if cli == native {
				if err := os.WriteFile(langyCLIRenderStamp(repo), []byte(langyCLIRender), 0o600); err != nil {
					t.Fatal(err)
				}
			}
		}
		o := &Orchestrator{sup: sup, sys: &fakeSystem{}, log: zap.NewNop()}
		st := domain.Stack{Slug: "demo", WorktreeDir: t.TempDir(), LangyTier: tier}
		o.ensureLangyCLI(context.Background(), st, &PlanOptions{RepoRoot: repo, Selection: domain.Selection{Langy: true}})
		return repo
	}

	t.Run("writes langwatch and lw shims that run the built CLI", func(t *testing.T) {
		sup := &fakeSupervisor{}
		repo := run(t, sup, native, domain.LangyTierHostUnsafe)
		if len(sup.shells) != 0 {
			t.Fatalf("built CLI was rebuilt: %v", sup.shells)
		}
		for _, name := range []string{"langwatch", "lw"} {
			body, err := os.ReadFile(filepath.Join(langyCLIBinDir(repo), name)) //nolint:gosec // G304: the test's own temp dir
			if err != nil || !strings.Contains(string(body), langyCLIEntry(repo)) {
				t.Fatalf("%s shim: %q, %v", name, body, err)
			}
		}
	})

	// @scenario "The host-tier Langy CLI is built with the native render"
	t.Run("builds a missing CLI first, with the native skills render", func(t *testing.T) {
		sup := &fakeSupervisor{}
		run(t, sup, missing, domain.LangyTierHostUnsafe)
		if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "LANGWATCH_SKILLS_RENDER=native pnpm --filter langwatch build") {
			t.Fatalf("expected one CLI build, got %v", sup.shells)
		}
	})

	// @scenario "A host-tier Langy CLI built without the native render is rebuilt"
	t.Run("rebuilds a CLI that lacks the native stamp, then stamps it", func(t *testing.T) {
		sup := &fakeSupervisor{}
		repo := run(t, sup, unstamped, domain.LangyTierHostUnsafe)
		if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "LANGWATCH_SKILLS_RENDER=native pnpm --filter langwatch build") {
			t.Fatalf("expected one native CLI build, got %v", sup.shells)
		}
		if !langyCLIIsNative(repo) {
			t.Fatal("rebuilt CLI carries no native stamp")
		}
	})

	// @scenario "Building the host-tier Langy CLI leaves the checkout's skills bundle on the cli render"
	t.Run("regenerates the cli bundle after the native build, keeping its exit status", func(t *testing.T) {
		sup := &fakeSupervisor{}
		run(t, sup, missing, domain.LangyTierHostUnsafe)
		want := "; rc=$?; LANGWATCH_SKILLS_RENDER=cli node sdks/typescript/scripts/generate-skills-bundle.mjs; exit $rc)"
		if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], want) {
			t.Fatalf("expected the build to restore the cli bundle, got %v", sup.shells)
		}
	})

	t.Run("does nothing for a container tier", func(t *testing.T) {
		sup := &fakeSupervisor{}
		repo := run(t, sup, missing, domain.LangyTierSandboxed)
		if _, err := os.Stat(langyCLIBinDir(repo)); len(sup.shells) != 0 || err == nil {
			t.Fatalf("container tier built or wrote shims: %v", sup.shells)
		}
	})

	// The failure hint is the only place a developer learns the manual build
	// command, so it must be the plain command, not the log-redirected shell.
	t.Run("failed build prints a plain manual build hint", func(t *testing.T) {
		sup := &fakeSupervisor{err: errors.New("build boom")}
		out := captureStdout(t, func() { run(t, sup, missing, domain.LangyTierHostUnsafe) })
		if !strings.Contains(out, langyCLIBuildCommand) || !strings.Contains(out, langyCLIRestoreBundleCommand) {
			t.Fatalf("the hint must name the native build and the bundle restore, got %q", out)
		}
		if strings.Contains(out, "rc=$?") || strings.Contains(out, "exit $rc") || strings.Contains(out, "2>&1") {
			t.Fatalf("the hint must be a plain command with no exit capture, got %q", out)
		}
	})
}

// @scenario "A Langy that cannot start leaves the app no dead agent address"
func TestDropLocalLangyAgentLeavesNoAgentURL(t *testing.T) {
	st := domain.Stack{Slug: "demo", Services: []domain.Service{{Name: "app", Port: 4000}, {Name: "langyagent", Port: 4123}}}
	if !dropLocalLangyAgent(&st) {
		t.Fatal("a local langyagent port was not dropped")
	}
	for _, line := range st.OverlayEnv() {
		if strings.HasPrefix(line, "LANGY_AGENT_URL=") || strings.HasPrefix(line, "LANGY_INTERNAL_SECRET=") {
			t.Fatalf("overlay still names the agent after Langy was skipped: %q", line)
		}
	}
	fallback := domain.Stack{Services: []domain.Service{{Name: "langyagent", Port: 4124, IsFallback: true}}}
	if dropLocalLangyAgent(&fallback) || fallback.Services[0].Port != 4124 {
		t.Fatal("a baseline stack's langyagent was dropped")
	}
}
