// Package otelnative implements app.Observability as host processes: the
// grafana/otel-lgtm stack (Alloy fronting Loki, Prometheus and Tempo, Grafana
// over all three) run from Homebrew binaries with no VM. Spec:
// specs/setup/haven-observability-native.feature. Configs are rendered by
// domain.NativeObservabilityComponents.
package otelnative

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/pinnedrelease"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Stack is the host-process implementation of app.Observability.
type Stack struct {
	plan      domain.NativeObservabilityPlan
	pinned    map[string]pinnedComponent // by component name: tempo and alloy
	container ContainerStack
}

// ContainerStack is the LGTM container tier, which publishes the same host
// ports; Ensure stops it before starting the native processes.
type ContainerStack interface {
	StopIfRunning(ctx context.Context) (bool, error)
}

// pinnedComponent is a component haven can fetch itself. override is the
// HAVEN_OBS_*_BIN path and wins; an empty artifact means PATH.
type pinnedComponent struct {
	override string
	artifact domain.PinnedArtifact
	dest     string
}

// Options are what New builds a Stack from.
type Options struct {
	Home          string // haven's home; the stack lives under home/observability
	Endpoints     domain.ObservabilityEndpoints
	Limits        domain.ObservabilityLimits
	TempoBin      string
	TempoArtifact domain.PinnedArtifact
	AlloyBin      string
	AlloyArtifact domain.PinnedArtifact
	Container     ContainerStack // nil when no container runtime is configured
}

// New builds a Stack whose files live under home/observability.
func New(o Options) *Stack {
	plan := domain.NativeObservabilityPlan{
		Dir:       filepath.Join(o.Home, "observability"),
		Endpoints: o.Endpoints,
		Ports:     domain.DefaultNativeObservabilityPorts(),
		Limits:    o.Limits,
	}
	return &Stack{plan: plan, container: o.Container, pinned: map[string]pinnedComponent{
		"tempo": {override: o.TempoBin, artifact: o.TempoArtifact, dest: plan.TempoBinary()},
		"alloy": {override: o.AlloyBin, artifact: o.AlloyArtifact, dest: plan.AlloyBinary()},
	}}
}

// Endpoints reports the stack's ports without touching anything.
func (s *Stack) Endpoints() domain.ObservabilityEndpoints { return s.plan.Endpoints }

// Ensure starts every component that is not already answering and waits for
// Grafana. A missing optional binary prints its install line and is skipped;
// a missing collector or Grafana is an error, which `up` reports and survives.
func (s *Stack) Ensure(ctx context.Context) (domain.ObservabilityEndpoints, error) {
	components, missing := s.resolve(ctx)
	var required []string
	for _, c := range missing {
		fmt.Fprintf(os.Stderr, "haven: observability: %s is not installed (%s)\n", c.Name, c.Install)
		if c.Required {
			required = append(required, c.Name)
		}
	}
	if len(required) > 0 {
		return domain.ObservabilityEndpoints{}, fmt.Errorf("observability needs %s installed", strings.Join(required, " and "))
	}
	s.retireContainer(ctx)
	limitMB := domain.NativeMemoryLimitMB(s.plan.Limits, len(components))
	for _, c := range components {
		if ready(ctx, c.ReadyURL) {
			continue // another worktree's stack, or still up from the last run
		}
		if conflict := s.portConflict(ctx, c); conflict != "" {
			fmt.Fprintf(os.Stderr, "haven: observability: %s\n", conflict)
			if c.Required {
				return domain.ObservabilityEndpoints{}, errors.New(conflict)
			}
			continue
		}
		if err := s.start(ctx, c, limitMB); err != nil {
			return domain.ObservabilityEndpoints{}, fmt.Errorf("starting %s: %w", c.Name, err)
		}
	}
	return s.plan.Endpoints, s.waitHealthy(ctx)
}

// retireContainer stops haven's own LGTM container when it runs, then waits
// for colima's forward of the Grafana port to close, so native can bind it.
func (s *Stack) retireContainer(ctx context.Context) {
	if s.container == nil {
		return
	}
	stopped, err := s.container.StopIfRunning(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "haven: observability: could not stop the %s container: %v\n", domain.ObservabilityContainer, err)
		return
	}
	if !stopped {
		return
	}
	fmt.Fprintf(os.Stderr, "haven: observability: stopped the %s container; native observability uses its ports now\n", domain.ObservabilityContainer)
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(500 * time.Millisecond) {
		if _, held := listener(ctx, s.plan.Endpoints.GrafanaPort); !held {
			return
		}
	}
}

// portConflict names the first of c's ports another process listens on ("" if none).
func (s *Stack) portConflict(ctx context.Context, c domain.NativeComponent) string {
	for _, port := range domain.NativeComponentPorts(s.plan, c.Name) {
		holder, held := listener(ctx, port)
		if msg := domain.PortConflict(domain.PortConflictQuery{Component: c.Name, Binary: c.Binary, Port: port, Holder: holder, Held: held}); msg != "" {
			return msg
		}
	}
	return ""
}

// listener is the process listening on a loopback TCP port, if any.
func listener(ctx context.Context, port int) (domain.PortHolder, bool) {
	// lsof exits 1 when nothing listens; the empty output already says so.
	out, _ := exec.CommandContext(ctx, "lsof", "-nP", "-iTCP:"+strconv.Itoa(port), "-sTCP:LISTEN", "-Fpc").Output() // #nosec G204 -- fixed argv; the port is an int
	return domain.ParseLsofListener(string(out))
}

// resolve splits the planned components into runnable ones (Binary set to an
// absolute path) and missing ones.
func (s *Stack) resolve(ctx context.Context) (runnable, missing []domain.NativeComponent) {
	grafanaHome := ""
	if bin, err := exec.LookPath("grafana"); err == nil {
		if resolved, err := filepath.EvalSymlinks(bin); err == nil {
			grafanaHome = domain.GrafanaHomePath(resolved)
		}
	}
	for _, c := range domain.NativeObservabilityComponents(s.plan, grafanaHome) {
		bin, err := s.binary(ctx, c)
		if err != nil {
			missing = append(missing, c)
			continue
		}
		c.Binary = bin
		runnable = append(runnable, c)
	}
	return runnable, missing
}

// binary finds a component's executable. Tempo and Alloy are their
// HAVEN_OBS_*_BIN when set, else the pinned release haven fetches, else
// whatever PATH holds; the rest come from PATH.
func (s *Stack) binary(ctx context.Context, c domain.NativeComponent) (string, error) {
	p, ok := s.pinned[c.Name]
	if !ok {
		return exec.LookPath(c.Binary)
	}
	if p.override != "" {
		return exec.LookPath(p.override)
	}
	if p.artifact.URL == "" {
		return exec.LookPath(c.Binary)
	}
	bin, err := pinnedrelease.Ensure(ctx, p.artifact, p.dest)
	if err != nil {
		fmt.Fprintf(os.Stderr, "haven: observability: fetching %s: %v\n", c.Name, err)
	}
	return bin, err
}

// start writes the component's configs and launches it in its own session, so
// it outlives `haven up` the way the container outlived it.
func (s *Stack) start(ctx context.Context, c domain.NativeComponent, limitMB int) error {
	for name, body := range c.Files {
		path := filepath.Join(s.plan.ConfigDir(), name)
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			return err
		}
	}
	for _, dir := range []string{s.plan.LogDir(), filepath.Join(s.plan.DataDir(), c.Name)} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
	}
	log, err := s.openLog(c.Name)
	if err != nil {
		return err
	}
	defer func() { _ = log.Close() }()
	// WithoutCancel: the process outlives this call, so ending ctx must not kill it.
	cmd := exec.CommandContext(context.WithoutCancel(ctx), c.Binary, c.Args...) // #nosec G204 -- a binary resolved by binary() with argv rendered by domain
	cmd.Dir = filepath.Join(s.plan.DataDir(), c.Name)
	cmd.Env = append(os.Environ(), fmt.Sprintf("GOMEMLIMIT=%dMiB", limitMB))
	cmd.Stdout, cmd.Stderr = log, log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// openLog appends to the component's log, starting it afresh once it passes
// the container's rotation size so a long-lived stack cannot fill the disk.
func (s *Stack) openLog(name string) (*os.File, error) {
	path := s.logPath(name)
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if info, err := os.Stat(path); err == nil && info.Size() > int64(s.plan.Limits.LogMaxSizeMB)<<20 {
		flags |= os.O_TRUNC
	}
	return os.OpenFile(path, flags, 0o600)
}

func (s *Stack) logPath(name string) string { return filepath.Join(s.plan.LogDir(), name+".log") }

// LogFiles are the per-component logs `haven logs obs` tails.
func (s *Stack) LogFiles() []string {
	var files []string
	for _, c := range domain.NativeObservabilityComponents(s.plan, "") {
		files = append(files, s.logPath(c.Name))
	}
	return files
}

// Stop ends every process whose argv names this stack's config directory and
// discards the collected data: a debugging window, not an archive.
func (s *Stack) Stop(ctx context.Context) error {
	// pkill exits 1 when nothing matched, which is a stopped stack, not an error.
	pkill := exec.CommandContext(ctx, "pkill", "-f", "--", s.plan.ConfigDir()) // #nosec G204 -- fixed pkill argv; the pattern is haven's own config path
	if err := pkill.Run(); err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 {
			return fmt.Errorf("pkill: %w", err)
		}
	}
	return os.RemoveAll(s.plan.DataDir())
}

// IsRunning reports whether Grafana is answering right now.
func (s *Stack) IsRunning(ctx context.Context) bool {
	return ready(ctx, s.plan.Endpoints.GrafanaURL()+"/api/health")
}

// Health is the one-liner `haven doctor` prints, naming each component that is
// down and why: a port another process holds, or not answering. A Grafana port
// answered by another process (the old container's forward) counts as down.
func (s *Stack) Health(ctx context.Context) (bool, string) {
	var down []string
	grafanaUp := false
	for _, c := range domain.NativeObservabilityComponents(s.plan, "") {
		up := ready(ctx, c.ReadyURL)
		if up && c.Name != "grafana" {
			continue
		}
		if conflict := s.portConflict(ctx, c); conflict != "" {
			down = append(down, conflict)
		} else if !up {
			down = append(down, c.Name+" not answering")
		} else {
			grafanaUp = true
		}
	}
	detail := fmt.Sprintf("native · grafana %s · otlp %s", s.plan.Endpoints.GrafanaURL(), s.plan.Endpoints.OTLPHTTPURL())
	if len(down) > 0 {
		detail += " · DOWN: " + strings.Join(down, "; ") + " (logs in " + s.plan.LogDir() + ")"
	}
	return grafanaUp, detail
}

func ready(ctx context.Context, url string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return false
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode == http.StatusOK
}

// waitHealthy blocks until Grafana answers. Like the container's check it does
// not prove every signal flows; Health names the components that are down.
func (s *Stack) waitHealthy(ctx context.Context) error {
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		if s.IsRunning(ctx) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return fmt.Errorf("native observability stack did not become healthy on %s — see %s",
		s.plan.Endpoints.GrafanaURL(), s.plan.LogDir())
}
