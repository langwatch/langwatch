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

// TerminateGroup SIGTERMs pid's whole process group — the shape every
// supervised child has (Setpgid), so one signal takes the child and its tree.
// Falls back to signalling just the pid when the group can't be resolved.
func (System) TerminateGroup(pid int) {
	if pgid, err := syscall.Getpgid(pid); err == nil && pgid > 1 {
		_ = syscall.Kill(-pgid, syscall.SIGTERM)
		return
	}
	System{}.Terminate(pid)
}

// PIDsOnPort lists the pids LISTENing on a TCP port, via lsof (macOS has no
// /proc; lsof is the same "ask the OS's own tool" approach used elsewhere).
func (System) PIDsOnPort(port int) []int {
	out, err := exec.Command("lsof", "-nP", "-ti", fmt.Sprintf("tcp:%d", port), "-sTCP:LISTEN").Output()
	if err != nil {
		return nil
	}
	var pids []int
	for _, f := range strings.Fields(string(out)) {
		if pid, err := strconv.Atoi(f); err == nil {
			pids = append(pids, pid)
		}
	}
	return pids
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

// GroupRSS sums the resident set of every process in pid's process group —
// the closest cheap approximation of what a supervised stack costs in RAM
// (the launcher spawns its children with Setpgid, so the group is the stack).
// Returns 0 when the group can't be read.
func (System) GroupRSS(pid int) uint64 {
	out, err := exec.Command("ps", "-o", "pgid=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return 0
	}
	pgid := strings.TrimSpace(string(out))
	if pgid == "" {
		return 0
	}
	all, err := exec.Command("ps", "-ax", "-o", "pgid=,rss=").Output()
	if err != nil {
		return 0
	}
	var kb uint64
	for _, line := range strings.Split(string(all), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || fields[0] != pgid {
			continue
		}
		if n, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
			kb += n
		}
	}
	return kb * 1024
}

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
