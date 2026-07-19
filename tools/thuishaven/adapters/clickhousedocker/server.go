// Package clickhousedocker implements app.ClickHouse: ONE shared Altinity
// ClickHouse container on the colima VM (the same VM the observability stack
// runs on), with a database per worktree slug. Replaces the earlier
// native-host-binary adapter so every contributor's setup is identical
// regardless of what they have brew-installed, and so the memory ceiling is
// enforced two ways: ClickHouse's own <max_server_memory_usage> AND a hard
// Docker cgroup limit — a runaway query is OOM-killed by the container rather
// than swelling into the host.
//
// Unlike the observability stack, this container is NOT ephemeral: its data
// directory is bind-mounted from haven's home, so a worktree's database
// survives restarts. Only `haven clickhouse drop` discards data, and only for
// the database it targets.
package clickhousedocker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/colima"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/netports"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Server is the colima-backed implementation of app.ClickHouse.
type Server struct {
	rt     *colima.Runtime
	home   string // <havenHome>/clickhouse
	image  string
	limits domain.ClickHouseLimits
}

// endpoint is the persisted record of the container's chosen host port, so a
// restart (and any already-migrated databases) keeps working on the same URL.
type endpoint struct {
	HTTPPort int `json:"httpPort"`
}

// New builds a Server. rt is shared with the observability stack — one colima
// VM, multiple containers. image defaults to domain.ClickHouseImage when empty.
func New(rt *colima.Runtime, havenHome, image string, limits domain.ClickHouseLimits) *Server {
	if image == "" {
		image = domain.ClickHouseImage
	}
	return &Server{rt: rt, home: filepath.Join(havenHome, "clickhouse"), image: image, limits: limits}
}

func (s *Server) dataDir() string      { return filepath.Join(s.home, "data") }
func (s *Server) configPath() string   { return filepath.Join(s.home, domain.ClickHouseConfigFile) }
func (s *Server) endpointPath() string { return filepath.Join(s.home, "endpoint.json") }

// Ensure starts the colima VM and the container if not already running, and
// returns the loopback HTTP port. Idempotent across worktrees: a container
// already running the right image is reused, which is what lets every worktree
// share one server.
func (s *Server) Ensure(ctx context.Context) (int, error) {
	dockerHost, err := s.rt.Ensure(ctx)
	if err != nil {
		return 0, err
	}

	ep, err := s.ensureEndpoint()
	if err != nil {
		return 0, err
	}

	// Written before the state check, not in start(): a container already running
	// the right image is otherwise never reconfigured, so a tuning change (the
	// system-log policy, a new memory ceiling) would reach new machines only.
	configChanged, err := s.writeConfig()
	if err != nil {
		return 0, err
	}

	switch state := s.containerState(ctx, dockerHost); {
	case state == stateRunningCorrectImage && !configChanged:
		if err := s.waitHealthy(ctx, ep.HTTPPort, 5*time.Second); err == nil {
			return ep.HTTPPort, nil
		}
		// Reported running but not answering yet (just started) — fall through to
		// the longer wait below instead of treating this as a hard failure.
	case state != stateAbsent:
		// Stopped, or running the wrong image after a pin bump. The data dir is a
		// host bind mount, so replacing the container keeps every database intact.
		_ = s.rt.Docker(ctx, dockerHost, "rm", "-f", domain.ClickHouseContainer).Run()
		fallthrough
	case state == stateAbsent:
		if err := s.start(ctx, dockerHost, ep); err != nil {
			return 0, err
		}
	}

	if err := s.waitHealthy(ctx, ep.HTTPPort, 40*time.Second); err != nil {
		return 0, err
	}
	if configChanged {
		s.applySystemLogPolicy(ctx)
	}
	return ep.HTTPPort, nil
}

// writeConfig renders the config.d override and reports whether it differs from
// what is already on disk (true on first write). Legacy filenames are cleared so
// haven's home never holds a stale config that looks live but is not mounted.
func (s *Server) writeConfig() (bool, error) {
	if err := os.MkdirAll(s.home, 0o755); err != nil {
		return false, err
	}
	for _, legacy := range domain.LegacyClickHouseConfigFiles {
		_ = os.Remove(filepath.Join(s.home, legacy))
	}
	rendered := domain.RenderClickHouseConfig(s.limits)
	existing, err := os.ReadFile(s.configPath())
	if err == nil && string(existing) == rendered {
		return false, nil
	}
	if err := os.WriteFile(s.configPath(), []byte(rendered), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

// applySystemLogPolicy retrofits the log policy onto tables that already exist.
// The config governs table *creation*, so a server that has been running since
// before the policy keeps its unbounded tables until they are dropped (the
// disabled ones, which the server will simply not recreate) or given a TTL (the
// kept ones). Best-effort by design: reclaiming disk must never be what stops a
// stack from coming up, and every statement here is idempotent.
func (s *Server) applySystemLogPolicy(ctx context.Context) {
	if !s.limits.LightweightLogs {
		return
	}
	ttlDays := s.limits.SystemLogTTLDays
	if ttlDays <= 0 {
		ttlDays = domain.DefaultSystemLogTTLDays
	}
	for _, name := range domain.NoisySystemLogs {
		_ = s.exec(ctx, "DROP TABLE IF EXISTS system."+name)
	}
	for _, name := range domain.KeptSystemLogs {
		_ = s.exec(ctx, fmt.Sprintf("ALTER TABLE system.%s MODIFY TTL event_date + INTERVAL %d DAY", name, ttlDays))
	}
}

func (s *Server) start(ctx context.Context, dockerHost string, ep endpoint) error {
	if err := os.MkdirAll(s.dataDir(), 0o755); err != nil {
		return err
	}
	if err := s.pull(ctx, dockerHost); err != nil {
		return err
	}
	if err := s.rt.Docker(ctx, dockerHost, s.runArgs(ep)...).Run(); err != nil {
		return fmt.Errorf("docker run %s: %w", domain.ClickHouseContainer, err)
	}
	return nil
}

// pull fetches the image with its progress on screen — quiet for a minute on an
// image this size reads as a hang.
func (s *Server) pull(ctx context.Context, dockerHost string) error {
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

// runArgs mirrors the observability stack's security-and-limits shape: loopback
// only, a high fd limit (ClickHouse wants it), a hard memory ceiling equal to
// the memory-swap limit (no thrash), and jemalloc tuned to return freed pages to
// the OS fast rather than let idle RSS creep.
func (s *Server) runArgs(ep endpoint) []string {
	l := s.limits
	return []string{
		"run", "-d",
		"--name", domain.ClickHouseContainer,
		"--restart", "unless-stopped",

		"-p", fmt.Sprintf("127.0.0.1:%d:8123", ep.HTTPPort),

		"--memory", fmt.Sprintf("%dm", l.ContainerMemoryMB),
		"--memory-swap", fmt.Sprintf("%dm", l.ContainerMemoryMB),
		"--ulimit", "nofile=262144:262144",

		"-e", "MALLOC_CONF=background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:0",
		"-e", "CLICKHOUSE_PASSWORD=" + domain.ClickHousePassword,

		"-v", s.dataDir() + ":/var/lib/clickhouse",
		"-v", s.configPath() + ":/etc/clickhouse-server/config.d/" + domain.ClickHouseConfigFile + ":ro",

		s.image,
	}
}

type containerState int

const (
	stateAbsent containerState = iota
	stateStopped
	stateRunningWrongImage
	stateRunningCorrectImage
)

func (s *Server) containerState(ctx context.Context, dockerHost string) containerState {
	out, err := s.rt.Docker(ctx, dockerHost,
		"inspect", "-f", "{{.State.Running}} {{.Config.Image}}", domain.ClickHouseContainer,
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

// ensureEndpoint returns the persisted host port, allocating one on first use.
func (s *Server) ensureEndpoint() (endpoint, error) {
	if ep, ok := s.readEndpoint(); ok {
		return ep, nil
	}
	if err := os.MkdirAll(s.home, 0o755); err != nil {
		return endpoint{}, err
	}
	ports, err := netports.Free(1)
	if err != nil {
		return endpoint{}, err
	}
	ep := endpoint{HTTPPort: ports[0]}
	return ep, s.writeEndpoint(ep)
}

func (s *Server) readEndpoint() (endpoint, bool) {
	var ep endpoint
	b, err := os.ReadFile(s.endpointPath())
	if err != nil {
		return ep, false
	}
	if json.Unmarshal(b, &ep) != nil || ep.HTTPPort == 0 {
		return ep, false
	}
	return ep, true
}

func (s *Server) writeEndpoint(ep endpoint) error {
	b, _ := json.MarshalIndent(ep, "", "  ")
	return os.WriteFile(s.endpointPath(), append(b, '\n'), 0o644)
}

func (s *Server) waitHealthy(ctx context.Context, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if s.ping(port) {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("clickhouse container did not become healthy within %s (see `docker logs %s`)",
		timeout, domain.ClickHouseContainer)
}

// EnsureDatabase creates a stack's database if it does not exist.
func (s *Server) EnsureDatabase(ctx context.Context, database string) error {
	return s.exec(ctx, "CREATE DATABASE IF NOT EXISTS "+quoteIdent(database))
}

// DropDatabase removes a stack's database.
func (s *Server) DropDatabase(ctx context.Context, database string) error {
	return s.exec(ctx, "DROP DATABASE IF EXISTS "+quoteIdent(database))
}

// Databases lists the lw_* databases currently on the server.
func (s *Server) Databases(ctx context.Context) ([]string, error) {
	body, err := s.query(ctx, "SELECT name FROM system.databases WHERE name LIKE 'lw\\_%' ORDER BY name FORMAT TabSeparated")
	if err != nil {
		return nil, err
	}
	var out []string
	for _, line := range strings.Split(strings.TrimSpace(body), "\n") {
		if line != "" {
			out = append(out, line)
		}
	}
	return out, nil
}

// HTTPPort returns the container's host port if provisioned (0 otherwise).
func (s *Server) HTTPPort() int {
	if ep, ok := s.readEndpoint(); ok {
		return ep.HTTPPort
	}
	return 0
}

// Running reports whether the managed server answers right now (no start).
func (s *Server) Running() bool {
	ep, ok := s.readEndpoint()
	return ok && s.ping(ep.HTTPPort)
}

// Health pings the server and returns a one-line status.
func (s *Server) Health(ctx context.Context) (bool, string) {
	ep, ok := s.readEndpoint()
	if !ok {
		return false, "not provisioned"
	}
	if !s.ping(ep.HTTPPort) {
		if !s.rt.IsRunning(ctx) {
			return false, fmt.Sprintf("colima profile %q is not running", s.rt.Profile())
		}
		return false, fmt.Sprintf("provisioned on :%d but not answering", ep.HTTPPort)
	}
	dbs, _ := s.Databases(ctx)
	detail := fmt.Sprintf("up on :%d, %d stack database(s)", ep.HTTPPort, len(dbs))
	if mem := s.memoryUse(ctx); mem != "" {
		detail += ", " + mem
	} else {
		detail += ", memory unreadable"
	}
	return true, detail
}

// memoryUse reports the server's resident memory against its configured
// ceiling ("" if it cannot be read) — the number that tells you whether the
// shared ClickHouse is the thing eating the machine.
func (s *Server) memoryUse(ctx context.Context) string {
	body, err := s.query(ctx, "SELECT formatReadableSize(value) FROM system.asynchronous_metrics WHERE metric = 'MemoryResident' FORMAT TabSeparated")
	if err != nil {
		return ""
	}
	used := strings.TrimSpace(body)
	if used == "" {
		return ""
	}
	return fmt.Sprintf("memory %s of %dMB cap", used, s.limits.ContainerMemoryMB)
}

// Stop removes the container. Data is a host bind mount, so this loses nothing —
// the next Ensure recreates the container over the same data dir and port.
func (s *Server) Stop() {
	ctx := context.Background()
	if !s.rt.IsRunning(ctx) {
		return
	}
	dockerHost, err := s.rt.DockerHost(ctx)
	if err != nil {
		return
	}
	_ = s.rt.Docker(ctx, dockerHost, "rm", "-f", domain.ClickHouseContainer).Run()
}

// --- HTTP helpers -----------------------------------------------------------

// ping does not authenticate — /ping is a pre-auth liveness probe on every
// ClickHouse server regardless of credentials, so it stays a plain GET.
func (s *Server) ping(port int) bool {
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/ping", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode == http.StatusOK && strings.Contains(string(b), "Ok")
}

func (s *Server) exec(ctx context.Context, sql string) error {
	_, err := s.query(ctx, sql)
	return err
}

// query authenticates as domain.ClickHouseUser — the Altinity image's bootstrap
// entrypoint requires CLICKHOUSE_PASSWORD to be set or it rejects the default
// user outright (unlike the earlier native-binary adapter's own passwordless
// users.xml), so every query beyond /ping needs Basic Auth.
func (s *Server) query(ctx context.Context, sql string) (string, error) {
	port := s.HTTPPort()
	if port == 0 {
		return "", fmt.Errorf("clickhouse not provisioned")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/", port), bytes.NewReader([]byte(sql)))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(domain.ClickHouseUser, domain.ClickHousePassword)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("clickhouse query failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return string(body), nil
}

// quoteIdent backtick-quotes a ClickHouse identifier. haven only ever passes
// lw_<slug> names (validated upstream), but quoting keeps the DDL well-formed.
func quoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}
