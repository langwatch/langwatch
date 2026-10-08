// Package clickhousenative implements app.ClickHouse as ONE shared upstream
// clickhouse-server running as a host process: the pinned official binary,
// downloaded into haven's home and checked against its sha256, a database per
// worktree slug, and the container's tuning. The memory ceiling is ClickHouse's
// own max_server_memory_usage only: macOS has no cgroup to enforce a hard one.
package clickhousenative

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/clickhousehttp"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/netports"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/pinnedrelease"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Server is the host-process implementation of app.ClickHouse.
type Server struct {
	home     string // <havenHome>/clickhouse-native
	artifact domain.PinnedArtifact
	limits   domain.ClickHouseLimits
	clickhousehttp.Client
}

type endpoint struct {
	HTTPPort int `json:"httpPort"`
}

// New builds a Server for the pinned artifact of this machine.
func New(havenHome string, artifact domain.PinnedArtifact, limits domain.ClickHouseLimits) *Server {
	s := &Server{home: filepath.Join(havenHome, domain.ClickHouseNativeDir), artifact: artifact, limits: limits}
	s.Client = clickhousehttp.Client{Port: s.HTTPPort}
	return s
}

func (s *Server) binaryPath() string {
	return filepath.Join(s.home, "bin", domain.ClickHouseNativeVersion, "clickhouse")
}
func (s *Server) configPath() string   { return filepath.Join(s.home, "config.xml") }
func (s *Server) endpointPath() string { return filepath.Join(s.home, "endpoint.json") }
func (s *Server) pidPath() string      { return filepath.Join(s.home, "clickhouse.pid") }
func (s *Server) stdoutPath() string   { return filepath.Join(s.home, "log", "stdout.log") }

// Ensure downloads the binary on first use, writes the config, and starts the
// server unless one is already answering on the pinned version and config.
// A changed config or version restarts it over the same data directory.
func (s *Server) Ensure(ctx context.Context) (int, error) {
	bin, err := s.ensureBinary(ctx)
	if err != nil {
		return 0, err
	}
	ep, err := s.ensureEndpoint()
	if err != nil {
		return 0, err
	}
	changed, err := s.writeConfig(ep.HTTPPort)
	if err != nil {
		return 0, err
	}
	if s.Ping(ep.HTTPPort) && !changed && s.runsPinnedVersion(ctx) {
		s.applySystemLogPolicy(ctx)
		return ep.HTTPPort, nil
	}
	s.Stop()
	if err := s.start(ctx, bin); err != nil {
		return 0, err
	}
	if err := s.WaitHealthy(ctx, ep.HTTPPort, 60*time.Second); err != nil {
		return 0, fmt.Errorf("%w (see %s)", err, filepath.Join(s.home, "log"))
	}
	s.applySystemLogPolicy(ctx)
	return ep.HTTPPort, nil
}

// ensureBinary installs the pinned binary on first use (see pinnedrelease).
func (s *Server) ensureBinary(ctx context.Context) (string, error) {
	bin, err := pinnedrelease.Ensure(ctx, s.artifact, s.binaryPath())
	if err != nil && s.artifact.URL == "" {
		return "", errors.New("no native ClickHouse is pinned for this machine (HAVEN_CH_RUNTIME=container uses the container)")
	}
	return bin, err
}

// writeConfig renders the main config, the users file and the same config.d /
// users.d overrides the container mounts, reporting whether any changed.
func (s *Server) writeConfig(port int) (bool, error) {
	files := map[string]string{
		s.configPath(): domain.RenderClickHouseNativeServerConfig(s.home, port),
		filepath.Join(s.home, "config.d", domain.ClickHouseConfigFile):     domain.RenderClickHouseConfig(s.limits),
		filepath.Join(s.home, "users.xml"):                                 domain.RenderClickHouseNativeUsersConfig(),
		filepath.Join(s.home, "users.d", domain.ClickHouseUsersConfigFile): domain.ClickHouseUsersConfig,
	}
	changed := false
	for path, rendered := range files {
		if existing, err := os.ReadFile(path); err == nil && string(existing) == rendered {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return false, err
		}
		if err := os.WriteFile(path, []byte(rendered), 0o600); err != nil {
			return false, err
		}
		changed = true
	}
	return changed, nil
}

// start runs the server in its own session, so it outlives the haven process
// that started it, exactly as the container outlives `docker run`.
func (s *Server) start(ctx context.Context, bin string) error {
	for _, dir := range []string{"data", "log"} {
		if err := os.MkdirAll(filepath.Join(s.home, dir), 0o750); err != nil {
			return err
		}
	}
	out, err := os.OpenFile(s.stdoutPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	// WithoutCancel: the server outlives this call, so ending ctx must not kill it.
	cmd := exec.CommandContext(context.WithoutCancel(ctx), bin, "server", "--config-file="+s.configPath()) // #nosec G204 -- haven's own verified binary
	cmd.Dir = s.home
	cmd.Stdout, cmd.Stderr = out, out
	cmd.Env = append(os.Environ(), "MALLOC_CONF=background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:0")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start clickhouse server: %w", err)
	}
	go func() { _ = cmd.Wait() }() // reaps it if it exits while this haven process lives
	return os.WriteFile(s.pidPath(), []byte(strconv.Itoa(cmd.Process.Pid)), 0o600)
}

func (s *Server) runsPinnedVersion(ctx context.Context) bool {
	v, err := s.Query(ctx, "SELECT version() FORMAT TabSeparated")
	return err == nil && strings.TrimSpace(v) == domain.ClickHouseNativeVersion
}

// applySystemLogPolicy is the container adapter's best-effort retrofit: every
// statement is idempotent and none may stop a stack coming up.
func (s *Server) applySystemLogPolicy(ctx context.Context) {
	for _, stmt := range domain.SystemLogRetrofitStatements(s.limits) {
		_ = s.Exec(ctx, stmt)
	}
}

// ownedPID is the recorded server pid while that process is still haven's
// clickhouse (its command line names this home), so a reused pid is never hit.
func (s *Server) ownedPID() (int, bool) {
	b, err := os.ReadFile(s.pidPath())
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	cmdline, err := exec.CommandContext(context.Background(), "ps", "-p", strconv.Itoa(pid), "-o", "command=").Output() // #nosec G204 -- fixed ps argv; the only variable is a parsed integer pid
	if err != nil || !strings.Contains(string(cmdline), s.configPath()) {
		return 0, false
	}
	return pid, true
}

// Stop terminates the server haven started and waits for it to exit, so a
// restart never finds the data directory still locked. Data is kept.
func (s *Server) Stop() {
	pid, ok := s.ownedPID()
	if !ok {
		return
	}
	_ = syscall.Kill(pid, syscall.SIGTERM)
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if syscall.Kill(pid, 0) != nil {
			_ = os.Remove(s.pidPath())
			return
		}
	}
	_ = syscall.Kill(pid, syscall.SIGKILL)
	_ = os.Remove(s.pidPath())
}

func (s *Server) ensureEndpoint() (endpoint, error) {
	if ep, ok := s.readEndpoint(); ok {
		return ep, nil
	}
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		return endpoint{}, err
	}
	ports, err := netports.Free(1)
	if err != nil {
		return endpoint{}, err
	}
	ep := endpoint{HTTPPort: ports[0]}
	b, _ := json.MarshalIndent(ep, "", "  ")
	return ep, os.WriteFile(s.endpointPath(), append(b, '\n'), 0o600)
}

func (s *Server) readEndpoint() (endpoint, bool) {
	var ep endpoint
	b, err := os.ReadFile(s.endpointPath())
	if err != nil || json.Unmarshal(b, &ep) != nil || ep.HTTPPort == 0 {
		return ep, false
	}
	return ep, true
}

// HTTPPort returns the server's port if provisioned (0 otherwise).
func (s *Server) HTTPPort() int {
	ep, _ := s.readEndpoint()
	return ep.HTTPPort
}

// Running reports whether the server answers right now (no start).
func (s *Server) Running() bool {
	ep, ok := s.readEndpoint()
	return ok && s.Ping(ep.HTTPPort)
}

// Health reports the native server's state. The cap it names is the engine's
// own soft limit: nothing on macOS enforces resident memory beneath it.
func (s *Server) Health(ctx context.Context) (bool, string) {
	ep, ok := s.readEndpoint()
	if !ok {
		return false, "native server not provisioned"
	}
	if !s.Ping(ep.HTTPPort) {
		return false, fmt.Sprintf("native server on :%d not answering (logs in %s)", ep.HTTPPort, filepath.Join(s.home, "log"))
	}
	dbs, _ := s.Databases(ctx)
	detail := fmt.Sprintf("native %s up on :%d, %d stack database(s)", domain.ClickHouseNativeVersion, ep.HTTPPort, len(dbs))
	if used := s.MemoryResident(ctx); used != "" {
		detail += fmt.Sprintf(", memory %s of %dMB soft cap (no OS ceiling)", used, s.limits.MaxServerMemory>>20)
	} else {
		detail += ", memory unreadable"
	}
	return true, detail
}
