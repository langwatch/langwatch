// Package otellgtm implements app.Observability: the shared local LGTM stack (an
// OTLP collector fronting Loki, Tempo and Prometheus, with Grafana over all
// three) that every worktree exports its logs, traces and metrics to.
//
// It is one container on the colima VM, resource-capped and ephemeral: no volume,
// so `haven observability down` reclaims every byte it collected.
package otellgtm

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/colima"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Stack is the colima-backed implementation of app.Observability.
type Stack struct {
	rt        *colima.Runtime
	home      string // haven's home dir; the derived prometheus config lives here
	image     string
	endpoints domain.ObservabilityEndpoints
	limits    domain.ObservabilityLimits
}

// New builds a Stack. image defaults to the pinned bundle when empty.
func New(rt *colima.Runtime, home, image string, endpoints domain.ObservabilityEndpoints, limits domain.ObservabilityLimits) *Stack {
	if image == "" {
		image = domain.ObservabilityImage
	}
	return &Stack{rt: rt, home: home, image: image, endpoints: endpoints, limits: limits}
}

// patch is one config file haven overrides: read it out of the image, edit the
// handful of keys we care about, mount the result back over the original.
type patch struct {
	containerPath string
	hostFile      string
	apply         func(config string, l domain.ObservabilityLimits) (string, error)
}

func (s *Stack) patches() []patch {
	return []patch{
		{domain.PrometheusConfigPath, "prometheus.yaml", func(c string, _ domain.ObservabilityLimits) (string, error) {
			return domain.PatchPrometheusConfig(c)
		}},
		{domain.LokiConfigPath, "loki-config.yaml", domain.PatchLokiConfig},
		{domain.TempoConfigPath, "tempo-config.yaml", domain.PatchTempoConfig},
	}
}

// ensureConfigs derives every override and returns them as `-v` mount arguments.
// They live under haven's home, which colima mounts into the VM, so they can be
// bind-mounted straight in.
//
// A failure here is loud but not fatal. Without the overrides the stack still
// works — it just keeps telemetry forever and can't filter metrics by worktree,
// which is worth a warning rather than a refusal to start.
func (s *Stack) ensureConfigs(ctx context.Context, dockerHost string) []string {
	var mounts []string
	for _, p := range s.patches() {
		hostPath, err := s.ensureConfig(ctx, dockerHost, p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "haven: could not cap %s (%v) — the stack will run with the image's defaults\n",
				p.hostFile, err)
			continue
		}
		// Read-only: haven owns these files, the container has no business rewriting them.
		mounts = append(mounts, "-v", hostPath+":"+p.containerPath+":ro")
	}
	return mounts
}

// ensureConfig writes one derived config, reusing it when it is already current.
// The marker records both the image and the limits, so bumping the retention
// regenerates the file rather than silently leaving the old cap in place.
func (s *Stack) ensureConfig(ctx context.Context, dockerHost string, p patch) (string, error) {
	path := filepath.Join(s.home, p.hostFile)
	marker := fmt.Sprintf("# derived by haven from %s (retention %s)", s.image, s.limits.Retention())
	if existing, err := os.ReadFile(path); err == nil && strings.HasPrefix(string(existing), marker) {
		return path, nil
	}

	out, err := s.rt.Docker(ctx, dockerHost,
		"run", "--rm", "--entrypoint", "cat", s.image, p.containerPath,
	).Output()
	if err != nil {
		return "", fmt.Errorf("reading %s out of the image: %w", p.containerPath, err)
	}
	patched, err := p.apply(string(out), s.limits)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		return "", err
	}
	body := marker + "\n# Regenerated when the image or the limits change; edit haven's limits, not this file.\n" + patched
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// Endpoints reports the stack's ports without touching the runtime.
func (s *Stack) Endpoints() domain.ObservabilityEndpoints { return s.endpoints }

// Ensure brings the stack up if it is not already answering, and returns the
// endpoints to export to. Idempotent: a container already running the right image
// is reused, which is what lets every worktree share one collector.
func (s *Stack) Ensure(ctx context.Context) (domain.ObservabilityEndpoints, error) {
	dockerHost, err := s.rt.Ensure(ctx)
	if err != nil {
		return domain.ObservabilityEndpoints{}, err
	}

	switch state := s.containerState(ctx, dockerHost); {
	case state == stateRunningCorrectImage:
		return s.endpoints, s.waitHealthy(ctx)
	case state != stateAbsent:
		// Stopped, or running the wrong image after a pin bump. The stack keeps no
		// volume, so replacing it costs nothing but the telemetry already collected.
		_ = s.rt.Docker(ctx, dockerHost, "rm", "-f", domain.ObservabilityContainer).Run()
	}

	if err := s.pull(ctx, dockerHost); err != nil {
		return domain.ObservabilityEndpoints{}, err
	}
	if err := s.rt.Docker(ctx, dockerHost, s.runArgs(s.ensureConfigs(ctx, dockerHost))...).Run(); err != nil {
		return domain.ObservabilityEndpoints{}, fmt.Errorf("docker run %s: %w", domain.ObservabilityContainer, err)
	}
	return s.endpoints, s.waitHealthy(ctx)
}

type containerState int

const (
	stateAbsent containerState = iota
	stateStopped
	stateRunningWrongImage
	stateRunningCorrectImage
)

func (s *Stack) containerState(ctx context.Context, dockerHost string) containerState {
	out, err := s.rt.Docker(ctx, dockerHost,
		"inspect", "-f", "{{.State.Running}} {{.Config.Image}}", domain.ObservabilityContainer,
	).Output()
	if err != nil {
		return stateAbsent
	}
	fields := strings.Fields(strings.TrimSpace(string(out)))
	if len(fields) != 2 || fields[0] != "true" {
		return stateStopped
	}
	if fields[1] != s.image {
		return stateRunningWrongImage
	}
	return stateRunningCorrectImage
}

// pull fetches the image with its progress on screen. `docker run` would pull
// silently, and the bundle is big enough that a quiet minute reads as a hang.
func (s *Stack) pull(ctx context.Context, dockerHost string) error {
	if s.rt.Docker(ctx, dockerHost, "image", "inspect", s.image).Run() == nil {
		return nil
	}
	fmt.Printf("pulling %s (first run only) ...\n", s.image)
	cmd := s.rt.Docker(ctx, dockerHost, "pull", s.image)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker pull %s: %w", s.image, err)
	}
	return nil
}

// runArgs is the whole security-and-limits story in one place. configMounts are
// the derived config overrides (retention + the worktree label), possibly empty.
func (s *Stack) runArgs(configMounts []string) []string {
	l := s.limits
	args := []string{
		"run", "-d",
		"--name", domain.ObservabilityContainer,
		"--restart", "unless-stopped",

		// Loopback-bound, every one: anonymous access to this Grafana is Admin, so
		// publishing on 0.0.0.0 would hand full Admin to anyone on the same network.
		"-p", fmt.Sprintf("127.0.0.1:%d:4317", s.endpoints.OTLPGRPCPort),
		"-p", fmt.Sprintf("127.0.0.1:%d:4318", s.endpoints.OTLPHTTPPort),
		"-p", fmt.Sprintf("127.0.0.1:%d:3000", s.endpoints.GrafanaPort),

		"--memory", fmt.Sprintf("%dm", l.MemoryMB),
		// Equal to --memory: no swap, so the ceiling is a real ceiling instead of a
		// point at which the whole VM starts thrashing.
		"--memory-swap", fmt.Sprintf("%dm", l.MemoryMB),
		"--cpus", fmt.Sprintf("%.2f", l.CPUs),
		"--pids-limit", fmt.Sprint(l.PidsLimit),

		"--log-driver", "json-file",
		"--log-opt", fmt.Sprintf("max-size=%dm", l.LogMaxSizeMB),
		"--log-opt", fmt.Sprintf("max-file=%d", l.LogMaxFiles),

		// Deterministic local-only creds so the Grafana token can be minted
		// non-interactively. Safe only because of the loopback binding above.
		"-e", "GF_SECURITY_ADMIN_USER=admin",
		"-e", "GF_SECURITY_ADMIN_PASSWORD=admin",
		"-e", "GF_AUTH_ANONYMOUS_ENABLED=true",
		"-e", "GF_AUTH_ANONYMOUS_ORG_ROLE=Admin",
		"-e", "GF_ANALYTICS_CHECK_FOR_UPDATES=false",
		"-e", "GF_NEWS_NEWS_FEED_ENABLED=false",

		"-e", "PROMETHEUS_EXTRA_ARGS=" + l.PrometheusExtraArgs(),
	}
	args = append(args, configMounts...)
	return append(args, s.image)
}

// Stop removes the container. The stack holds no volume, so this discards the
// collected telemetry by design — it is a debugging window, not an archive.
func (s *Stack) Stop(ctx context.Context) error {
	// If the VM is down the container is already gone with it — starting colima
	// just to remove a container that isn't running would be perverse.
	if !s.rt.IsRunning(ctx) {
		return nil
	}
	dockerHost, err := s.rt.DockerHost(ctx)
	if err != nil {
		return err
	}
	return s.rt.Docker(ctx, dockerHost, "rm", "-f", domain.ObservabilityContainer).Run()
}

// IsRunning reports whether Grafana is answering right now. It probes the port
// rather than asking docker, so it is cheap enough for the daemon's monitor loop
// and true only when the stack is actually usable.
func (s *Stack) IsRunning(ctx context.Context) bool {
	return s.ping(ctx) == nil
}

// Health is the one-liner `haven doctor` prints. It reports the image that is
// actually running, not the one haven would run — they differ after a pin bump,
// and that difference is the whole reason someone reads this line.
func (s *Stack) Health(ctx context.Context) (bool, string) {
	if err := s.ping(ctx); err != nil {
		if !s.rt.IsRunning(ctx) {
			return false, fmt.Sprintf("colima profile %q is not running", s.rt.Profile())
		}
		return false, fmt.Sprintf("not answering on %s", s.endpoints.GrafanaURL())
	}
	detail := fmt.Sprintf("grafana %s · otlp %s", s.endpoints.GrafanaURL(), s.endpoints.OTLPHTTPURL())
	switch image := s.runningImage(ctx); image {
	case "":
		// Answering, but not from a container haven knows about — someone is running
		// their own Grafana on this port. Say so rather than claim ownership.
		detail += " · not haven-managed"
	case s.image:
		detail += " · " + image
	default:
		detail += fmt.Sprintf(" · %s (haven would run %s — `haven observability up` replaces it)", image, s.image)
	}
	return true, detail
}

// runningImage is the image of the haven-managed container, or "" if there isn't one.
func (s *Stack) runningImage(ctx context.Context) string {
	dockerHost, err := s.rt.DockerHost(ctx)
	if err != nil {
		return ""
	}
	out, err := s.rt.Docker(ctx, dockerHost,
		"inspect", "-f", "{{.Config.Image}}", domain.ObservabilityContainer,
	).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (s *Stack) ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.endpoints.GrafanaURL()+"/api/health", nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("grafana health returned %d", resp.StatusCode)
	}
	return nil
}

// waitHealthy blocks until Grafana answers. Note this only proves Grafana is up —
// see domain.ObservabilityImage on why that is not the same as all three signals
// being up, and why the image pin matters.
func (s *Stack) waitHealthy(ctx context.Context) error {
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		if err := s.ping(ctx); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return fmt.Errorf("observability stack did not become healthy on %s — `docker logs %s`",
		s.endpoints.GrafanaURL(), domain.ObservabilityContainer)
}
