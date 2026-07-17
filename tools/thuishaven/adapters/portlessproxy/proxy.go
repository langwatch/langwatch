// Package portlessproxy implements app.Proxy by driving the portless CLI. warren
// never fights portless for the listening socket — portless owns the proxy port,
// this adapter just registers and removes hostname->loopback aliases.
package portlessproxy

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

// resolveBinary returns a real, runnable portless binary and true, or "" and
// false when only the `npx --yes portless` fallback is available. It is the
// single source of truth for both argv() and Installed(), so the two can never
// disagree about whether portless is installed. PORTLESS_BIN and the
// project-local candidate must point at an executable file to count — a stale or
// misconfigured path falls through rather than being trusted.
func (p *Proxy) resolveBinary() (string, bool) {
	if bin := os.Getenv("PORTLESS_BIN"); bin != "" && isExecutableFile(bin) {
		return bin, true
	}
	local := filepath.Join(p.lwDir, "node_modules", ".bin", "portless")
	if isExecutableFile(local) {
		return local, true
	}
	if onPath, err := exec.LookPath("portless"); err == nil {
		return onPath, true
	}
	return "", false
}

func (p *Proxy) argv() []string {
	if bin, ok := p.resolveBinary(); ok {
		return []string{bin}
	}
	return []string{"npx", "--yes", "portless"}
}

// Installed reports whether a real portless binary is resolvable (PORTLESS_BIN,
// project-local, or on PATH) as opposed to the `npx --yes portless` fallback,
// which would re-download on every call. This is the signal `haven setup` uses
// to decide whether to ask the user to install portless first.
func (p *Proxy) Installed() bool {
	_, ok := p.resolveBinary()
	return ok
}

// isExecutableFile reports whether path is a regular file with an executable bit
// set — a candidate we can actually run, not a directory or a dangling path.
func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode().Perm()&0o111 != 0
}

func (p *Proxy) run(args ...string) error {
	argv := append(p.argv(), args...)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = append(os.Environ(), "PORTLESS_TLD="+p.naming.TLD)
	return cmd.Run()
}

// runVerbose runs a portless subcommand with output inherited, so bootstrap
// steps (proxy start, trust) surface progress and any keychain prompt inline.
func (p *Proxy) runVerbose(args ...string) error {
	argv := append(p.argv(), args...)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = append(os.Environ(), "PORTLESS_TLD="+p.naming.TLD)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}

// EnsureReady boots the proxy and trusts its CA so `haven up` self-bootstraps.
// Starting is idempotent (a running proxy is left alone); trust is guarded by a
// marker in the state dir so it runs at most once per machine and never
// re-prompts for the keychain on subsequent launches.
func (p *Proxy) EnsureReady() error {
	if !p.Running() {
		// User-level `proxy start` needs no sudo and is enough to route this dev
		// session (it prints "already running" and exits 0 if a proxy — e.g. the
		// root launchd service — already holds the port). The persistent root
		// service stays opt-in via `haven setup`, which needs sudo and so
		// must not be triggered from a possibly-non-interactive `pnpm dev`.
		if err := p.runVerbose("proxy", "start"); err != nil {
			return fmt.Errorf("could not start the portless proxy: %w", err)
		}
		if !p.waitRunning(5 * time.Second) {
			return fmt.Errorf("portless proxy did not come up in time")
		}
	}
	p.ensureTrusted()
	return nil
}

// waitRunning polls until the proxy daemon reports alive or the deadline passes.
func (p *Proxy) waitRunning(d time.Duration) bool {
	deadline := time.Now().Add(d)
	for {
		if p.Running() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// ensureTrusted installs the portless CA into the system trust store once.
// Best-effort: a declined keychain prompt leaves HTTPS untrusted (browser
// warnings) but must not fail `up`. The marker is written only on success, so a
// failed attempt retries next launch rather than being silently skipped.
func (p *Proxy) ensureTrusted() {
	dir := p.stateDir()
	// portless writes `ca.trusted` once its CA is in the system store; our own
	// `.haven-trusted` records a haven-driven trust. Either means the (possibly
	// sudo/keychain-prompting) `trust` step is already done — skip it.
	if fileExists(filepath.Join(dir, "ca.trusted")) || fileExists(filepath.Join(dir, ".haven-trusted")) {
		return
	}
	if err := p.runVerbose("trust"); err != nil {
		return
	}
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, ".haven-trusted"), []byte("ok\n"), 0o644)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
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

// CACertPath returns the filesystem path to the portless Local CA certificate
// (PEM), or "" when it is not present yet. Bun and Node do NOT consult the macOS
// system trust store — only their own bundled roots plus NODE_EXTRA_CA_CERTS — so
// even though `ensureTrusted` put this CA in the system store (which fixes curl,
// Go, and the browser), the app's and the langy worker's JS runtimes still reject
// the portless HTTPS hostnames. The orchestrator points NODE_EXTRA_CA_CERTS at
// this path (see planChildren) to close that gap in dev.
func (p *Proxy) CACertPath() string {
	ca := filepath.Join(p.stateDir(), "ca.pem")
	if !fileExists(ca) {
		return ""
	}
	return ca
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
	return aliveFromSignalErr(proc.Signal(sig0))
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
