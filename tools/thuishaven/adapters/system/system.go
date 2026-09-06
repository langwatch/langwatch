// Package system implements app.System — the OS facts the orchestrator needs
// (free ports, process liveness, detached spawn), behind a port so the app can
// be tested with a fake.
package system

import (
	"bufio"
	"context"
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
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
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

// ownsGroup reports whether pid is the leader of its own process group, which
// is the shape of everything haven starts: supervised children get Setpgid and
// the detached launcher gets Setsid, so each leads the group it is signalled by.
//
// It is the identity check the group signals need. A recorded pid is only
// evidence that a process was alive when it was written down; the kernel
// recycles pids, so by the time `down` runs, that number may belong to an
// unrelated process — and signalling ITS group would kill a stranger's process
// tree, potentially the developer's shell. A recycled pid is overwhelmingly
// unlikely to also lead its group, so requiring leadership turns a broadcast
// into a signal we can only aim at ourselves. It also excludes the two
// catastrophic targets by construction: kill(-1, …) would hit every process
// this user can signal, and kill(-0, …) our own group.
func ownsGroup(pid int) bool {
	if pid <= 1 {
		return false
	}
	pgid, err := syscall.Getpgid(pid)
	return err == nil && pgid == pid
}

// KillGroup SIGKILLs pid's whole process group — the no-grace hard stop behind
// `haven down -f`. When pid does not lead its group it is not the process we
// recorded, so only that pid is signalled, never a group.
func (s System) KillGroup(pid int) {
	if ownsGroup(pid) {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Signal(syscall.SIGKILL)
	}
}

// TerminateGroup SIGTERMs pid's whole process group — the shape every
// supervised child has (Setpgid), so one signal takes the child and its tree.
// Falls back to signalling just the pid on the same identity check as KillGroup.
func (System) TerminateGroup(pid int) {
	if ownsGroup(pid) {
		_ = syscall.Kill(-pid, syscall.SIGTERM)
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
	out, err := probe("ps", "-o", "pgid=", "-p", strconv.Itoa(pid))
	if err != nil {
		return 0
	}
	pgid := strings.TrimSpace(string(out))
	if pgid == "" {
		return 0
	}
	all, err := probe("ps", "-ax", "-o", "pgid=,rss=")
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
		out, err := probe("sysctl", "-n", "hw.memsize")
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

// MemStat samples the machine's memory-pressure signals.
//
// Compressor occupancy and swap, not summed RSS: GroupRSS sums `ps` output,
// which double-counts shared pages and overstates by several GB. The parsing
// lives in domain, because the arithmetic is the part that is easy to get
// wrong and the shelling out is not.
//
// A signal that cannot be read stays zero, which classifies green. That is
// deliberate — a governor that cannot see the machine must not throttle it.
func (s System) MemStat() domain.MemStat {
	m := domain.MemStat{TotalBytes: s.TotalMemory()}
	if runtime.GOOS != "darwin" {
		return m
	}
	if out, err := probe("vm_stat"); err == nil {
		if pageSize, occupied, ok := domain.ParseVMStat(string(out)); ok {
			m.CompressedBytes = occupied * pageSize
		}
	}
	if out, err := probe("sysctl", "-n", "vm.swapusage"); err == nil {
		if used, total, ok := domain.ParseSwapUsage(string(out)); ok {
			m.SwapUsedBytes, m.SwapTotalBytes = used, total
		}
	}
	return m
}

// probeTimeout bounds every external command the governor shells out to.
//
// These all run on the daemon's tick. One that blocks — a wedged `ps`, a `vm_stat`
// against a stuck VM subsystem — would stop the tick completing, and readers age
// the pressure record out to green after 90s. The machine would lose governance
// silently, which is the one failure mode worth spending a deadline on.
const probeTimeout = 2 * time.Second

// probe runs a short-lived read-only command under that deadline.
func probe(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).Output()
}

// DemoteGroup moves every process in pid's group into the throttled background
// band, and RestoreGroup moves them back out.
//
// It walks the group rather than signaling the launcher, because the policy is
// inherited by processes forked AFTER it is set — it does not reach back into a
// tree that is already running, and a live stack is exactly that: vite, node
// and workers already spawned under the launcher. Signaling the launcher alone
// would demote the launcher alone.
func (s System) DemoteGroup(pid int) { s.retierGroup(pid, "-b") }

// RestoreGroup undoes DemoteGroup. A process spawned while its stack was
// demoted inherits the band, so restoring walks the group again rather than
// trying to remember what was demoted.
func (s System) RestoreGroup(pid int) { s.retierGroup(pid, "-B") }

func (System) retierGroup(pid int, flag string) {
	if runtime.GOOS != "darwin" || pid <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	for _, member := range groupMembers(pid) {
		// Best effort per process: one that exits between listing and signaling
		// is not an error, and must not stop the rest of the group being moved.
		// The deadline is shared across the group for the same reason it exists at
		// all — this runs on the daemon's tick and must always return to it.
		_ = exec.CommandContext(ctx, "taskpolicy", flag, "-p", strconv.Itoa(member)).Run()
	}
}

// groupMembers lists every live pid sharing pid's process group.
//
// One `ps` listing, not two: the same table that names the members also names
// the group, so asking for the group first was a second full process listing for
// a number already in hand. Both sides are compared as INTEGERS — two ps
// invocations can format the same group differently, and a padding difference
// silently yielded an empty group, which reads as "nothing to demote" rather
// than as a failure.
func groupMembers(pid int) []int {
	out, err := probe("ps", "-ax", "-o", "pgid=,pid=")
	if err != nil {
		return nil
	}

	byGroup := parseProcessGroups(string(out))
	for group, members := range byGroup {
		for _, member := range members {
			if member == pid {
				return byGroup[group]
			}
		}
	}
	return nil
}

// parseProcessGroups indexes a `ps -o pgid=,pid=` listing by group.
func parseProcessGroups(listing string) map[int][]int {
	byGroup := map[int][]int{}
	for line := range strings.SplitSeq(listing, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		group, groupErr := strconv.Atoi(fields[0])
		member, memberErr := strconv.Atoi(fields[1])
		if groupErr != nil || memberErr != nil {
			continue
		}
		byGroup[group] = append(byGroup[group], member)
	}
	return byGroup
}

// psCommandColumns is how many leading numeric columns the orphan listing asks
// for before the command itself (ppid, pid).
const psCommandColumns = 2

// ProcessSamples lists every live process with the facts the tsgo governor
// needs (ADR-095). A row whose numbers do not parse is dropped: the governor
// makes kill decisions from these samples, so it never guesses.
func (System) ProcessSamples() []app.ProcessSample {
	out, err := probe("ps", "-ax", "-o", "pid=,ppid=,pgid=,rss=,cputime=,etime=,command=")
	if err != nil {
		return nil
	}
	var samples []app.ProcessSample
	for line := range strings.SplitSeq(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		pid, pidErr := strconv.Atoi(fields[0])
		ppid, ppidErr := strconv.Atoi(fields[1])
		pgid, pgidErr := strconv.Atoi(fields[2])
		rssKB, rssErr := strconv.ParseInt(fields[3], 10, 64)
		cpu, cpuOK := domain.ParsePSDuration(fields[4])
		elapsed, elapsedOK := domain.ParsePSDuration(fields[5])
		if pidErr != nil || ppidErr != nil || pgidErr != nil || rssErr != nil || !cpuOK || !elapsedOK {
			continue
		}
		samples = append(samples, app.ProcessSample{
			PID:      pid,
			PPID:     ppid,
			PGID:     pgid,
			RSSBytes: rssKB << 10,
			CPUTime:  cpu,
			Elapsed:  elapsed,
			Command:  strings.Join(fields[6:], " "),
		})
	}
	return samples
}

// Kill SIGKILLs one process — never its group (see the port's contract: the
// governor's targets live in process groups whose other members must survive).
func (System) Kill(pid int) {
	if pid <= 0 {
		return
	}
	_ = syscall.Kill(pid, syscall.SIGKILL)
}

// OrphanedWorkers lists test-worker processes whose parent is PID 1 — on macOS
// that is launchd, and it means an interrupted run left them behind.
//
// haven already sweeps orphans at every `up` (procsupervisor.reapOrphans); this
// is the same rule on the daemon's tick, widened to the vitest workers that
// CLAUDE.md currently asks people to pkill by hand. The rule is deliberately
// narrow: matching the worker path AND being owned by nobody. Anything needing
// a judgment about whether a process is still wanted stays manual.
// An empty marker matches nothing. The result of this is group-killed, so the
// rule has to be narrower than its inputs: a marker that arrived empty by
// accident would otherwise select every orphaned process on the machine.
func (System) OrphanedWorkers(marker string) []int {
	if marker == "" {
		return nil
	}
	out, err := probe("ps", "-ax", "-o", "ppid=,pid=,command=")
	if err != nil {
		return nil
	}
	var orphans []int
	for line := range strings.SplitSeq(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) <= psCommandColumns || fields[0] != "1" {
			continue
		}
		// The COMMAND only. The line begins with two numeric columns, so matching
		// the whole of it lets a marker match a pid — and the caller kills the
		// group of whatever it matched, which is not an outcome to be approximate
		// about.
		if !strings.Contains(strings.Join(fields[psCommandColumns:], " "), marker) {
			continue
		}
		if pid, err := strconv.Atoi(fields[1]); err == nil {
			orphans = append(orphans, pid)
		}
	}
	return orphans
}
