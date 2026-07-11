// Package clickhouseserver implements app.ClickHouse: it provisions and manages
// ONE shared, single-node, memory-capped native clickhouse-server on the host,
// with a database per worktree slug. Sharing one server keeps memory bounded when
// many worktrees are open; the per-slug database gives each worktree an isolated
// schema, so "the migration count is wrong, use a fresh CH db" simply cannot
// happen — each worktree only ever sees its own database.
//
// The server is configured for fast, light local dev: modest memory caps, no S3
// or cold-storage tiering, and no zero-copy replication (prod-only concerns that
// only hurt locally). It is a persistent singleton like the repo's shared Redis /
// Postgres; the daemon can stop it when idle to reclaim memory.
package clickhouseserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Server is the host-process-backed implementation of app.ClickHouse.
type Server struct {
	dir       string // <havenHome>/clickhouse
	binEnv    string // CLICKHOUSE_BIN override
	maxMemory int64  // max_server_memory_usage (bytes)
}

// endpoint is the persisted record of the managed server's chosen ports, so a
// restart reuses the same ports (and any already-migrated databases keep working).
type endpoint struct {
	HTTPPort int `json:"httpPort"`
	TCPPort  int `json:"tcpPort"`
}

// New builds a Server rooted under the thuishaven home dir. maxMemory is the
// server-wide memory ceiling in bytes (0 → a 4 GiB default).
func New(home, binEnv string, maxMemory int64) *Server {
	if maxMemory <= 0 {
		maxMemory = 4 << 30 // 4 GiB — a shared, single-node local ceiling
	}
	return &Server{dir: filepath.Join(home, "clickhouse"), binEnv: binEnv, maxMemory: maxMemory}
}

func (s *Server) dataDir() string      { return filepath.Join(s.dir, "data") }
func (s *Server) configPath() string   { return filepath.Join(s.dir, "config.xml") }
func (s *Server) usersPath() string    { return filepath.Join(s.dir, "users.xml") }
func (s *Server) logPath() string      { return filepath.Join(s.dir, "server.log") }
func (s *Server) pidPath() string      { return filepath.Join(s.dir, "server.pid") }
func (s *Server) endpointPath() string { return filepath.Join(s.dir, "endpoint.json") }
func (s *Server) lockPath() string     { return filepath.Join(s.dir, "start.lock") }

// binary locates the clickhouse executable: CLICKHOUSE_BIN, then PATH. When it is
// absent, the error carries install guidance (like portless-setup does).
func (s *Server) binary() (string, error) {
	if s.binEnv != "" {
		return s.binEnv, nil
	}
	if p, err := exec.LookPath("clickhouse"); err == nil {
		return p, nil
	}
	hint := "install it and re-run"
	if runtime.GOOS == "darwin" {
		hint = "install with: brew install --cask clickhouse"
	} else if runtime.GOOS == "linux" {
		hint = "install with: curl https://clickhouse.com/ | sh   (or set CLICKHOUSE_BIN)"
	}
	return "", fmt.Errorf("clickhouse binary not found on PATH — %s", hint)
}

// Ensure starts the shared server if it is not already answering and returns its
// HTTP port. It is safe under concurrent `haven up` from multiple worktrees: a
// file lock serialises the start, and a double-check avoids a redundant launch.
func (s *Server) Ensure(ctx context.Context) (int, error) {
	if ep, ok := s.readEndpoint(); ok && s.ping(ep.HTTPPort) {
		return ep.HTTPPort, nil
	}
	bin, err := s.binary()
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(s.dataDir(), 0o755); err != nil {
		return 0, err
	}

	release, err := s.lock()
	if err != nil {
		return 0, err
	}
	defer release()

	// Someone else may have started it while we waited for the lock.
	if ep, ok := s.readEndpoint(); ok && s.ping(ep.HTTPPort) {
		return ep.HTTPPort, nil
	}

	ep, ok := s.readEndpoint()
	if !ok {
		ports, err := freePorts(2)
		if err != nil {
			return 0, err
		}
		ep = endpoint{HTTPPort: ports[0], TCPPort: ports[1]}
		if err := s.writeEndpoint(ep); err != nil {
			return 0, err
		}
	}

	if err := s.writeConfig(ep); err != nil {
		return 0, err
	}
	if err := s.spawn(bin); err != nil {
		return 0, err
	}
	if err := s.waitHealthy(ctx, ep.HTTPPort, 40*time.Second); err != nil {
		return 0, err
	}
	return ep.HTTPPort, nil
}

func (s *Server) spawn(bin string) error {
	logf, err := os.OpenFile(s.logPath(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, "server", "--config-file="+s.configPath())
	cmd.Dir = s.dir
	cmd.Env = os.Environ()
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} // outlive the launcher
	if err := cmd.Start(); err != nil {
		_ = logf.Close()
		return err
	}
	_ = os.WriteFile(s.pidPath(), []byte(strconv.Itoa(cmd.Process.Pid)+"\n"), 0o644)
	_ = logf.Close()
	return cmd.Process.Release()
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
	return fmt.Errorf("clickhouse-server did not become healthy within %s (see %s)", timeout, s.logPath())
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
	port := s.HTTPPort()
	if port == 0 {
		return nil, fmt.Errorf("clickhouse not provisioned")
	}
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

// HTTPPort returns the managed server's HTTP port if provisioned (0 otherwise).
func (s *Server) HTTPPort() int {
	if ep, ok := s.readEndpoint(); ok {
		return ep.HTTPPort
	}
	return 0
}

// Running reports whether the managed server answers right now.
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
		return false, fmt.Sprintf("provisioned on :%d but not answering", ep.HTTPPort)
	}
	dbs, _ := s.Databases(ctx)
	return true, fmt.Sprintf("up on :%d, %d stack database(s)", ep.HTTPPort, len(dbs))
}

// Stop halts the managed server but leaves its data + endpoint on disk so the
// next Ensure reuses the same ports and databases.
func (s *Server) Stop() {
	b, err := os.ReadFile(s.pidPath())
	if err != nil {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 0 {
		return
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	_ = proc.Signal(syscall.SIGTERM)
	for i := 0; i < 50; i++ {
		if proc.Signal(syscall.Signal(0)) != nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = proc.Signal(syscall.SIGKILL)
	_ = os.Remove(s.pidPath())
}

// --- HTTP helpers -----------------------------------------------------------

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

func (s *Server) query(ctx context.Context, sql string) (string, error) {
	port := s.HTTPPort()
	if port == 0 {
		return "", fmt.Errorf("clickhouse not provisioned")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/", port), bytes.NewReader([]byte(sql)))
	if err != nil {
		return "", err
	}
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

// --- persistence + config ---------------------------------------------------

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

// lock takes an exclusive file lock so two concurrent `haven up` invocations do
// not both try to start the server. The returned func releases it.
func (s *Server) lock() (func(), error) {
	f, err := os.OpenFile(s.lockPath(), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		_ = f.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, nil
}

func (s *Server) writeConfig(ep endpoint) error {
	config := fmt.Sprintf(configTemplate,
		s.logPath(),
		ep.HTTPPort,
		ep.TCPPort,
		s.dataDir()+string(os.PathSeparator),
		filepath.Join(s.dataDir(), "tmp")+string(os.PathSeparator),
		filepath.Join(s.dataDir(), "user_files")+string(os.PathSeparator),
		s.maxMemory,
	)
	if err := os.WriteFile(s.configPath(), []byte(config), 0o644); err != nil {
		return err
	}
	users := fmt.Sprintf(usersTemplate, s.maxMemory/2)
	return os.WriteFile(s.usersPath(), []byte(users), 0o644)
}

// freePorts grabs n distinct free loopback TCP ports.
func freePorts(n int) ([]int, error) {
	var ports []int
	var held []net.Listener
	for i := 0; i < n; i++ {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			for _, h := range held {
				_ = h.Close()
			}
			return nil, err
		}
		held = append(held, l)
		ports = append(ports, l.Addr().(*net.TCPAddr).Port)
	}
	for _, h := range held {
		_ = h.Close()
	}
	return ports, nil
}

// quoteIdent backtick-quotes a ClickHouse identifier. haven only ever passes
// lw_<slug> names (validated upstream), but quoting keeps the DDL well-formed.
func quoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

// configTemplate is a single-node local config: modest caches, a server memory
// ceiling, and — deliberately — no <storage_configuration>/S3 disks and no
// zero-copy replication. Those are prod concerns that only slow local dev down.
const configTemplate = `<clickhouse>
    <logger><level>warning</level><console>true</console><log>%s</log><size>50M</size><count>3</count></logger>
    <http_port>%d</http_port>
    <tcp_port>%d</tcp_port>
    <listen_host>127.0.0.1</listen_host>
    <path>%s</path>
    <tmp_path>%s</tmp_path>
    <user_files_path>%s</user_files_path>
    <user_directories><users_xml><path>users.xml</path></users_xml></user_directories>
    <max_server_memory_usage>%d</max_server_memory_usage>
    <mark_cache_size>268435456</mark_cache_size>
    <uncompressed_cache_size>0</uncompressed_cache_size>
    <max_concurrent_queries>32</max_concurrent_queries>
    <mlock_executable>false</mlock_executable>
    <default_profile>default</default_profile>
    <default_database>default</default_database>
</clickhouse>
`

// usersTemplate caps per-query memory (half the server ceiling) and only allows
// loopback connections — this is a throwaway local dev server.
const usersTemplate = `<clickhouse>
    <profiles><default>
        <max_memory_usage>%d</max_memory_usage>
        <max_execution_time>300</max_execution_time>
        <load_balancing>random</load_balancing>
        <log_queries>0</log_queries>
    </default></profiles>
    <users><default>
        <password></password>
        <networks><ip>127.0.0.1</ip><ip>::1</ip></networks>
        <profile>default</profile>
        <quota>default</quota>
        <access_management>1</access_management>
        <named_collection_control>1</named_collection_control>
    </default></users>
    <quotas><default/></quotas>
</clickhouse>
`
