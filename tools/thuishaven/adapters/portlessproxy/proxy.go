// Package portlessproxy implements app.Proxy by driving the portless CLI. warren
// never fights portless for the listening socket — portless owns the proxy port,
// this adapter just registers and removes hostname->loopback aliases.
package portlessproxy

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Proxy is the portless-backed implementation of app.Proxy.
type Proxy struct {
	naming domain.Naming
	lwDir  string
}

// New builds a Proxy. lwDir is used to find a project-local portless install.
func New(naming domain.Naming, lwDir string) *Proxy {
	return &Proxy{naming: naming, lwDir: lwDir}
}

func (p *Proxy) argv() []string {
	if bin := os.Getenv("PORTLESS_BIN"); bin != "" {
		return []string{bin}
	}
	local := filepath.Join(p.lwDir, "node_modules", ".bin", "portless")
	if _, err := os.Stat(local); err == nil {
		return []string{local}
	}
	if onPath, err := exec.LookPath("portless"); err == nil {
		return []string{onPath}
	}
	return []string{"npx", "--yes", "portless"}
}

func (p *Proxy) run(args ...string) error {
	argv := append(p.argv(), args...)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = append(os.Environ(), "PORTLESS_TLD="+p.naming.TLD)
	return cmd.Run()
}

// Register points a hostname at a loopback port (idempotent via --force).
func (p *Proxy) Register(service, slug string, port int) error {
	return p.run("alias", p.naming.RouteName(service, slug), strconv.Itoa(port), "--force")
}

// Remove tears a hostname's route down.
func (p *Proxy) Remove(service, slug string) {
	_ = p.run("alias", "--remove", p.naming.RouteName(service, slug))
}

func (p *Proxy) stateDir() string {
	if v := os.Getenv("PORTLESS_STATE_DIR"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".portless")
}

// Running reports whether the portless proxy daemon is alive.
func (p *Proxy) Running() bool {
	b, err := os.ReadFile(filepath.Join(p.stateDir(), "proxy.pid"))
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(sig0) == nil
}

// Endpoint reports how the proxy is reachable, reading portless's own state and
// honouring env overrides. Falls back to the portless default (https on 443).
func (p *Proxy) Endpoint() (string, int) {
	dir := p.stateDir()
	port, tls := 443, true
	if b, err := os.ReadFile(filepath.Join(dir, "proxy.port")); err == nil {
		if v, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil {
			port = v
		}
	}
	if b, err := os.ReadFile(filepath.Join(dir, "proxy.tls")); err == nil {
		t := strings.TrimSpace(string(b))
		tls = t != "0" && t != ""
	}
	if v := os.Getenv("PORTLESS_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			port = n
		}
	}
	if os.Getenv("PORTLESS_HTTPS") == "0" {
		tls = false
	}
	if tls {
		return "https", port
	}
	return "http", port
}
