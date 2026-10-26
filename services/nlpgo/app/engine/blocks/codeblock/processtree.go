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
// yet reaped, process-wide rather than per-Executor because the teardown sweep
// reasons about every child of this process at once.
//
// Teardown treats a child of the engine that is in this set as a running
// execution and anything else as a process that escaped one (see
// processtree_linux.go). That inference is why registration and exec.Cmd.Start
// happen under the same write lock: a pid that existed but was not yet
// registered would read as an escapee and be killed moments after it started.
type liveChildren struct {
	mu   sync.RWMutex
	pids map[int]struct{}
}

var runningChildren = &liveChildren{pids: map[int]struct{}{}}

// start launches cmd and registers its pid in one atomic step.
func (l *liveChildren) start(cmd *exec.Cmd) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := cmd.Start(); err != nil {
		return err
	}
	l.pids[cmd.Process.Pid] = struct{}{}
	return nil
}

// release forgets a pid once exec has reaped it.
func (l *liveChildren) release(pid int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.pids, pid)
}

// snapshot returns the registered pids. The caller holds nothing afterwards, so
// a pid it reports is only a pid that was running an execution at the moment of
// the call; identifying a process and killing it are therefore separate steps,
// and only the first one needs the lock.
func (l *liveChildren) snapshot() map[int]struct{} {
	l.mu.RLock()
	defer l.mu.RUnlock()
	live := make(map[int]struct{}, len(l.pids))
	for pid := range l.pids {
		live[pid] = struct{}{}
	}
	return live
}
