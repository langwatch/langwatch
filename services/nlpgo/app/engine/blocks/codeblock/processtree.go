package codeblock

import (
	"os/exec"
	"sync"
)

// runTokenEnvVar carries one execution's random token into every process it
// starts. The value identifies the run to teardown and nothing else: it is not
// a credential and names neither project nor workflow.
const runTokenEnvVar = "NLPGO_CODE_BLOCK_RUN"

// payloadChannelEnvVar names the socket the runner asks for its payload on.
// Not a secret: see payloadchannel_linux.go.
const payloadChannelEnvVar = "NLPGO_CODE_BLOCK_CHANNEL"

// runScope names the processes one execution is allowed to leave behind — none.
// It carries the handles teardown identifies them by: the interpreter the
// executor started, its process group, the token every process in the run
// inherits in its environment, and the run's working directory.
type runScope struct {
	pid   int
	pgid  int
	token string
	dir   string
}

// liveRun is one running execution as the rest of the package needs it: when
// its interpreter started, which dates the processes it leaves behind, and the
// payload that interpreter has not collected yet.
type liveRun struct {
	startTicks uint64
	payload    []byte
}

// liveChildren is the set of interpreters the executor has started and not yet
// reaped, process-wide rather than per-Executor because the teardown sweep
// reasons about every child of this process at once, and because the payload
// channel answers by pid without knowing which Executor started it.
//
// Teardown reads it twice over (see processtree_linux.go): a child of the
// engine in this set is a running execution, and a process that cannot have
// come from any execution in it belongs to one that has finished. Registration
// and exec.Cmd.Start happen under the same write lock so that a pid which
// exists is a pid already registered.
type liveChildren struct {
	mu   sync.RWMutex
	runs map[int]*liveRun
}

var runningChildren = &liveChildren{runs: map[int]*liveRun{}}

// start launches cmd and registers it in one atomic step, with the start time
// read while the process is certain to be alive: its /proc entry is gone once
// exec has reaped it, and teardown needs that time to date the run.
//
// The payload is registered with it, because the interpreter may ask for it
// before Start has even returned to the caller.
func (l *liveChildren) start(cmd *exec.Cmd, payload []byte) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := cmd.Start(); err != nil {
		return err
	}
	l.runs[cmd.Process.Pid] = &liveRun{
		startTicks: runStartMarker(cmd.Process.Pid),
		payload:    payload,
	}
	return nil
}

// claimPayload hands out one execution's payload once, to whoever is entitled
// to it. A pid that is not a running execution, and a second ask for one that
// has already collected, both get nothing.
func (l *liveChildren) claimPayload(pid int) []byte {
	l.mu.Lock()
	defer l.mu.Unlock()
	run, ok := l.runs[pid]
	if !ok || run.payload == nil {
		return nil
	}
	payload := run.payload
	run.payload = nil
	return payload
}

// release forgets a pid once exec has reaped it.
func (l *liveChildren) release(pid int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.runs, pid)
}

// snapshot returns the running executions with the times they started. The
// caller holds nothing afterwards, so what it reports is the set of executions
// that were running at the moment of the call; identifying a process and
// killing it are therefore separate steps, and only the first one needs the
// lock.
func (l *liveChildren) snapshot() map[int]uint64 {
	l.mu.RLock()
	defer l.mu.RUnlock()
	live := make(map[int]uint64, len(l.runs))
	for pid, run := range l.runs {
		live[pid] = run.startTicks
	}
	return live
}
