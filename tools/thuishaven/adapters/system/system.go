// Package system implements app.System — the OS facts the orchestrator needs
// (free ports, process liveness, detached spawn), behind a port so the app can
// be tested with a fake.
package system

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/netports"
)

// System is the real OS-backed implementation of app.System.
type System struct{}

// New returns a System.
func New() System { return System{} }

// FreePorts grabs n distinct free loopback TCP ports (bind :0, read, close).
func (System) FreePorts(n int) ([]int, error) {
	return netports.Free(n)
}

// PortInUse reports whether something is listening on a loopback port now.
func (System) PortInUse(port int) bool {
	c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 250*time.Millisecond)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}

// ProcessAlive reports whether a pid is a live process.
func (System) ProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return p.Signal(syscall.Signal(0)) == nil
}

// Terminate sends SIGTERM so a launcher can clean up its own children.
func (System) Terminate(pid int) {
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Signal(syscall.SIGTERM)
	}
}

// SpawnDetached starts a process in its own session so it outlives the caller —
// used to bring the singleton daemon up from `up`.
func (System) SpawnDetached(argv []string, dir, logPath string) error {
	if len(argv) == 0 {
		return fmt.Errorf("empty argv")
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Env = os.Environ()
	f, ferr := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if ferr == nil {
		cmd.Stdout, cmd.Stderr = f, f
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		if ferr == nil {
			_ = f.Close()
		}
		return err
	}
	// The child has its own dup'd fd; the parent must close its copy.
	if ferr == nil {
		_ = f.Close()
	}
	return cmd.Process.Release()
}

// Now returns the current time. Getpid returns this process's pid.
func (System) Now() time.Time { return time.Now() }
func (System) Getpid() int    { return os.Getpid() }

// TotalMemory returns the machine's physical RAM in bytes (0 if undetectable).
// darwin: sysctl hw.memsize; linux: /proc/meminfo MemTotal.
func (System) TotalMemory() uint64 {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
		if err != nil {
			return 0
		}
		n, _ := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
		return n
	case "linux":
		f, err := os.Open("/proc/meminfo")
		if err != nil {
			return 0
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			fields := strings.Fields(sc.Text())
			if len(fields) >= 2 && fields[0] == "MemTotal:" {
				kb, _ := strconv.ParseUint(fields[1], 10, 64)
				return kb * 1024
			}
		}
	}
	return 0
}
