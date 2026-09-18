package app

import (
	"strings"
	"testing"
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
		t.Run("sets PORT, ENVIRONMENT, pretty logging and the internal secret", func(t *testing.T) {
			for _, want := range []string{"'PORT=49624'", "'ENVIRONMENT=local'", "'LOG_FORMAT=pretty'", "'LANGY_INTERNAL_SECRET=sekret'"} {
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
			if !strings.Contains(sh, "docker build -f Dockerfile.langyagent -t 'langyagent:dev' .") {
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
			if !strings.HasPrefix(sh, "docker build -f Dockerfile.langyagent") {
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
