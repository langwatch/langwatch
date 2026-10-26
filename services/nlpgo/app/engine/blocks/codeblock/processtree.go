package codeblock

import (
	"os/exec"
	"sync"
)

// runTokenEnvVar carries one execution's random token into every process it
// starts. The value identifies the run to teardown and nothing else: it is not
// a credential and names neither project nor workflow.
const runTokenEnvVar = "NLPGO_CODE_BLOCK_RUN"

// runScope names the processes one execution is allowed to leave behind — none.
// It carries the handles teardown identifies them by: the interpreter the
// executor started, its process group, the token every process in the run
// inherits in its environment, and the run's working directory.
type runScope struct {
	pid   int
	pgid  int
	token string
	dir   string
	// startTicks is when the interpreter started, in the kernel's unit. A
	// process this process did not start and that is older than this cannot
	// have come from this execution.
	startTicks uint64
}

// liveChildren is the set of interpreter pids the executor has started and not
// yet reaped, each with the moment it started, process-wide rather than
// per-Executor because the teardown sweep reasons about every child of this
// process at once.
//
// Teardown reads it twice over (see processtree_linux.go): a child of the
// engine in this set is a running execution, and a process that cannot have
// come from any execution in it belongs to one that has finished. Registration
// and exec.Cmd.Start happen under the same write lock so that a pid which
// exists is a pid already registered.
type liveChildren struct {
	mu   sync.RWMutex
	pids map[int]uint64
}

var runningChildren = &liveChildren{pids: map[int]uint64{}}

// start launches cmd and registers its pid in one atomic step, with the start
// time read while the process is certain to be alive: its /proc entry is gone
// once exec has reaped it, and teardown needs that time to date the run.
func (l *liveChildren) start(cmd *exec.Cmd) (uint64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	startTicks := runStartMarker(cmd.Process.Pid)
	l.pids[cmd.Process.Pid] = startTicks
	return startTicks, nil
}

// release forgets a pid once exec has reaped it.
func (l *liveChildren) release(pid int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.pids, pid)
}

// snapshot returns the registered pids with their start times. The caller
// holds nothing afterwards, so what it reports is the set of executions that
// were running at the moment of the call; identifying a process and killing it
// are therefore separate steps, and only the first one needs the lock.
func (l *liveChildren) snapshot() map[int]uint64 {
	l.mu.RLock()
	defer l.mu.RUnlock()
	live := make(map[int]uint64, len(l.pids))
	for pid, startTicks := range l.pids {
		live[pid] = startTicks
	}
	return live
}
