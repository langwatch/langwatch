//go:build linux

// Process teardown for one execution, Linux.
//
// Killing the interpreter's process group covers everything user code starts
// in the ordinary way, and nothing it starts after calling setsid(2): a
// detached grandchild keeps running with a process group of its own, which is
// how a code block left a background process behind that outlived the run.
//
// The escape a shared PID namespace does NOT offer is becoming someone else's
// descendant. An orphan reparents to the nearest ancestor marked
// PR_SET_CHILD_SUBREAPER, or to PID 1 when there is none, so the engine marks
// itself: every process an execution leaves behind is then either still inside
// the run's process group or a direct child of the engine, and both sets are
// enumerable from /proc. Teardown kills both, and keeps scanning until the run
// owns no live process at all.
//
// This needs no privilege the container does not already have: no capability,
// no cgroup write, no PID namespace of its own and no second UID. See the
// package doc for the alternatives and why they are out of reach here.
package codeblock

import (
	"bytes"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// prSetChildSubreaper is PR_SET_CHILD_SUBREAPER: orphaned descendants reparent
// to this process instead of to PID 1. prSetDumpable is PR_SET_DUMPABLE, which
// at 0 takes this process's own /proc files away from processes running as the
// same user.
const (
	prSetDumpable       = 4
	prSetChildSubreaper = 36
)

// hardeningOnce guards one pass of prctls per process, and subreaperActive
// records whether the subreaper flag took. Without that flag a detached
// grandchild reparents to PID 1 and leaves the sweep with no way to tell it
// apart from the rest of the container, so the orphan rule is only applied
// when this is true.
var (
	hardeningOnce   sync.Once
	subreaperActive bool
)

// teardownDeadline bounds the sweep. SIGKILL is not refusable, so a pass that
// finds nothing left is the normal case and this only bounds the pathological
// one (a process wedged in an uninterruptible syscall), where blocking the
// worker forever is worse than returning.
const teardownDeadline = 2 * time.Second

// enableProcessHardening prepares this process for running untrusted code.
// Called when an Executor is built, because from then on this process spawns
// code that runs as the same user it does.
//
// PR_SET_CHILD_SUBREAPER makes the engine the reaper for orphaned descendants,
// which is what teardown is built on.
//
// PR_SET_DUMPABLE 0 takes the engine's own /proc files away from every other
// process running as that same user, and a code block is one of those. Without
// it, the engine's own process environment is readable by any code block that
// looks — the whole pod environment this executor's allowlist exists to
// withhold, including the database and ClickHouse credentials and the
// instance's own LangWatch key — and the engine's memory and open descriptors
// go with it. What stays readable is stat, status and cmdline, which is all
// teardown and the metrics this service exports read; the protected files
// become root-owned, so the engine cannot read its own either, and nothing
// here does (no os.Executable, no /proc/self reader, runtime metrics come from
// runtime/metrics). The other cost is core dumps of the engine, which nothing
// collects, and reading those files from inside the container as the same
// user, which a distroless image has no shell for anyway.
func enableProcessHardening() {
	hardeningOnce.Do(func() {
		_, _, errno := syscall.Syscall(syscall.SYS_PRCTL, prSetChildSubreaper, 1, 0)
		subreaperActive = errno == 0
		_, _, _ = syscall.Syscall(syscall.SYS_PRCTL, prSetDumpable, 0, 0)
	})
}

// terminateRunTree kills every process the execution still owns and reaps the
// ones that have become this process's children. A process still standing
// after the deadline is logged: SIGKILL cannot be refused, so this is a
// process wedged in the kernel, and the run it came from is over.
func terminateRunTree(scope runScope, logger *zap.Logger) {
	if scope.pgid > 0 {
		_ = syscall.Kill(-scope.pgid, syscall.SIGKILL)
	}
	selfPid := os.Getpid()
	deadline := time.Now().Add(teardownDeadline)
	for {
		claimed := claimedProcesses(scope, selfPid)
		if len(claimed) == 0 {
			return
		}
		killAndReap(claimed, selfPid)
		if time.Now().After(deadline) {
			logger.Warn("nlpgo_code_block_teardown_incomplete",
				zap.Ints("pids", pidsOf(claimed)),
				zap.String("hint", "these processes outlived a code block and did not die to SIGKILL within the deadline, which means they are blocked in the kernel; they hold a slot in the container's process table until they unblock"),
			)
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// killAndReap kills what the run still owns, and collects the exit status of
// the ones that became this process's children: ours since they were orphaned,
// and left uncollected they would each hold a slot in the process table for as
// long as the engine runs.
func killAndReap(claimed []procEntry, selfPid int) {
	for _, proc := range claimed {
		if !proc.zombie {
			_ = syscall.Kill(proc.pid, syscall.SIGKILL)
		}
		if proc.ppid == selfPid {
			var status syscall.WaitStatus
			_, _ = syscall.Wait4(proc.pid, &status, syscall.WNOHANG, nil)
		}
	}
}

func pidsOf(entries []procEntry) []int {
	pids := make([]int, 0, len(entries))
	for _, entry := range entries {
		pids = append(pids, entry.pid)
	}
	return pids
}

// procEntry is the part of /proc/<pid>/stat teardown reads.
type procEntry struct {
	pid    int
	ppid   int
	pgid   int
	zombie bool
	// startTicks is the process's start time in the kernel's own
	// boot-relative unit, which is what makes "started after the
	// interpreter did" answerable without a clock conversion.
	startTicks uint64
}

// runStartMarker reads the interpreter's start time, taken right after it
// starts because the entry is gone once the process is reaped. Teardown uses
// it to leave alone an orphan that predates the execution.
func runStartMarker(pid int) uint64 {
	entry, ok := readProcEntry(pid)
	if !ok {
		return 0
	}
	return entry.startTicks
}

// claimedProcesses returns the live processes belonging to the run: the
// interpreter, anything sharing its process group, every descendant of those,
// and the orphans the engine has adopted that are tied to this run rather than
// to an execution still going (see claimsOrphan).
//
// The table is read BEFORE the live-execution set, and the order is the whole
// reason a child another execution starts mid-sweep is not read as an escapee:
// a pid is registered under the same lock as its Start, so a process already in
// the table is a process the later snapshot is bound to report.
func claimedProcesses(scope runScope, selfPid int) []procEntry {
	entries := readProcTable()
	pass := sweep{
		scope:   scope,
		selfPid: selfPid,
		live:    runningChildren.snapshot(),
	}

	claimed := make(map[int]struct{}, len(entries))
	for _, entry := range entries {
		if pass.claims(entry) {
			claimed[entry.pid] = struct{}{}
		}
	}
	addDescendants(entries, claimed)

	out := make([]procEntry, 0, len(claimed))
	for _, entry := range entries {
		if _, ok := claimed[entry.pid]; ok {
			out = append(out, entry)
		}
	}
	return out
}

// maxAncestryHops bounds the walk up the parent links. The chain is a tree, so
// it terminates on its own; the bound is there in case a /proc read mid-scan
// returns a parent that has already been replaced.
const maxAncestryHops = 64

// addDescendants widens the claimed set to everything below it. User code's
// own children share the run's process group, but a grandchild of a process
// that orphaned itself is reached only by following the parent links.
func addDescendants(entries []procEntry, claimed map[int]struct{}) {
	parents := make(map[int]int, len(entries))
	for _, entry := range entries {
		parents[entry.pid] = entry.ppid
	}
	for _, entry := range entries {
		for pid, hops := entry.ppid, 0; pid > 1 && hops < maxAncestryHops; pid, hops = parents[pid], hops+1 {
			if _, ok := claimed[pid]; ok {
				claimed[entry.pid] = struct{}{}
				break
			}
		}
	}
}

// sweep is one teardown pass: the run being cleared up, this process's pid,
// and the executions that were running when the pass began.
type sweep struct {
	scope   runScope
	selfPid int
	live    map[int]uint64
}

// claims decides whether one process belongs to the run.
//
// A process that left the run's group did so by being orphaned, so the only
// candidates beyond the group are the children of whoever adopts orphans: this
// process when the subreaper flag took, PID 1 when it did not. Everything else
// is reached as a descendant of one of those, which is why this never has to
// read a file for a process that is neither.
func (s sweep) claims(entry procEntry) bool {
	switch {
	case entry.pid == s.selfPid || entry.pid <= 1:
		return false
	case entry.pid == s.scope.pid:
		return true
	case s.scope.pgid > 0 && entry.pgid == s.scope.pgid:
		return true
	case entry.ppid == s.selfPid || entry.ppid == 1:
		return s.claimsOrphan(entry)
	default:
		return false
	}
}

// claimsOrphan decides on a process whose parent is gone. Being adopted says
// an execution started it, not which one, so it is claimed only on a positive
// tie to this run: a mark it still carries, or a start time no running
// execution can account for. Anything that may belong to an execution still
// running is left alone — killing another tenant's live helper is worse than
// leaving a process of a finished run for the next teardown to find.
func (s sweep) claimsOrphan(entry procEntry) bool {
	if s.servesALiveRun(entry) {
		return false
	}
	return s.carriesRunMarks(entry.pid) || s.noLiveRunCanAccountForIt(entry)
}

// servesALiveRun reports whether the process is an execution still running or
// sits in one's process group, which is where a child that was orphaned
// without detaching stays.
func (s sweep) servesALiveRun(entry procEntry) bool {
	if _, running := s.live[entry.pid]; running {
		return true
	}
	_, inGroup := s.live[entry.pgid]
	return inGroup
}

// carriesRunMarks reads the marks a process inherits from the run that started
// it and keeps through losing its parent and its process group: the run's
// token in its environment, and its working directory. Both are per-run, so a
// process carrying either is this run's and no other's.
func (s sweep) carriesRunMarks(pid int) bool {
	return (s.scope.token != "" && hasRunToken(pid, s.scope.token)) ||
		(s.scope.dir != "" && worksInside(pid, s.scope.dir))
}

// noLiveRunCanAccountForIt dates an orphan that scrubbed both marks. A process
// cannot be older than whatever started it, so one that predates every
// execution still running came from an execution that has already finished, and
// nothing is waiting on it. Which finished execution it was does not matter:
// whichever teardown finds it owes it the same SIGKILL.
//
// Only applied with the engine as subreaper, where a child of the engine is an
// execution or came from one. Without that flag an orphan lands on PID 1 beside
// the container's unrelated processes, and the marks are the only tie there is.
func (s sweep) noLiveRunCanAccountForIt(entry procEntry) bool {
	if !subreaperActive || entry.ppid != s.selfPid {
		return false
	}
	for pid, startTicks := range s.live {
		if pid != s.scope.pid && startTicks <= entry.startTicks {
			return false
		}
	}
	return true
}

// procPath names one of a process's /proc files. Built by hand rather than
// with filepath.Join, which reads a separator inside a literal as a mistake:
// these are the fixed names of a kernel filesystem, not parts a caller passed.
func procPath(pid int, name string) string {
	return "/proc/" + strconv.Itoa(pid) + "/" + name
}

// readProcTable reads every process in the namespace. Entries that disappear
// mid-scan are skipped: a process that exited between the readdir and the read
// is one teardown no longer has to kill.
func readProcTable() []procEntry {
	dir, err := os.Open("/proc")
	if err != nil {
		return nil
	}
	defer func() { _ = dir.Close() }()
	names, err := dir.Readdirnames(-1)
	if err != nil {
		return nil
	}
	entries := make([]procEntry, 0, len(names))
	for _, name := range names {
		pid, err := strconv.Atoi(name)
		if err != nil {
			continue
		}
		entry, ok := readProcEntry(pid)
		if !ok {
			continue
		}
		entries = append(entries, entry)
	}
	return entries
}

// readProcEntry parses state, ppid and process group out of /proc/<pid>/stat.
//
// The second field is the executable name in parentheses and may itself contain
// spaces and parentheses, so the fixed fields are counted from the LAST ')'
// rather than from a split of the whole line.
func readProcEntry(pid int) (procEntry, bool) {
	raw, err := os.ReadFile(procPath(pid, "stat"))
	if err != nil {
		return procEntry{}, false
	}
	commEnd := bytes.LastIndexByte(raw, ')')
	if commEnd < 0 || commEnd+2 >= len(raw) {
		return procEntry{}, false
	}
	fields := strings.Fields(string(raw[commEnd+1:]))
	if len(fields) < 3 {
		return procEntry{}, false
	}
	ppid, err := strconv.Atoi(fields[1])
	if err != nil {
		return procEntry{}, false
	}
	pgid, err := strconv.Atoi(fields[2])
	if err != nil {
		return procEntry{}, false
	}
	entry := procEntry{pid: pid, ppid: ppid, pgid: pgid, zombie: fields[0] == "Z"}
	// Field 22 of the whole line, so index 19 counting from the state field.
	if len(fields) > 19 {
		entry.startTicks, _ = strconv.ParseUint(fields[19], 10, 64)
	}
	return entry, true
}

// hasRunToken reports whether the process still carries the run's token. The
// runner puts it in its own environment, so anything it starts inherits it,
// which survives the detach a process group does not — right up to an exec
// with a scrubbed environment, which is what the orphan rule is for.
//
// Never consulted for the interpreter, which makes itself non-dumpable and
// would refuse this read: it is named by pid and process group instead. The
// same is true of a descendant that forked without exec and kept that flag,
// which the process group or the orphan rule catches.
func hasRunToken(pid int, token string) bool {
	raw, err := os.ReadFile(procPath(pid, "environ"))
	if err != nil {
		return false
	}
	for _, entry := range bytes.Split(raw, []byte{0}) {
		if string(entry) == runTokenEnvVar+"="+token {
			return true
		}
	}
	return false
}

// worksInside reports whether the process's working directory is the run's
// directory or below it.
func worksInside(pid int, dir string) bool {
	cwd, err := os.Readlink(procPath(pid, "cwd"))
	if err != nil {
		return false
	}
	return cwd == dir || strings.HasPrefix(cwd, dir+string(os.PathSeparator))
}
