package app

import "github.com/langwatch/langwatch/tools/thuishaven/domain"

// pidIsOurs reports whether pid is still the process haven recorded: alive and,
// when a start time was recorded and ps can read one now, started then (D6).
// An unreadable start keeps today's liveness answer, so a ps hiccup never
// reaps a live stack; only a definite mismatch makes the pid a stranger.
func (o *Orchestrator) pidIsOurs(pid int, start string) bool {
	if pid <= 0 || !o.sys.ProcessAlive(pid) {
		return false
	}
	if start == "" {
		return true
	}
	now := o.sys.ProcessStart(pid)
	return now == "" || now == start
}

// launcherIsOurs is pidIsOurs for a stack's launcher: what every reap, signal
// and governance decision asks before it acts on LauncherPID.
func (o *Orchestrator) launcherIsOurs(s domain.Stack) bool {
	return o.pidIsOurs(s.LauncherPID, s.LauncherStart)
}
