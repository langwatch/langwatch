//go:build unix

package claudecode

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

// A `claude -p` run spawns its own children: the shell commands of its Bash
// tool, a test runner, a dev server. Nothing tells them to stop when the
// harness dies with the CLI still running; they reparent to pid 1 and keep
// burning tokens into a pipe nobody reads. Two measures keep that from
// happening:
//
//  1. The CLI leads its own process group, so a kill aimed at the group
//     reaches every descendant, not only the CLI. Call kills the group on
//     timeout and cancellation and never returns while the CLI runs.
//  2. A watchdog shell, detached from both, polls the harness pid and kills
//     the group when the harness is gone. That covers a harness killed by a
//     signal, os.Exit or a crash, where no Go code runs. It exits by itself
//     the moment the CLI exits, so a healthy turn leaves nothing behind.

// watchdogScript is the watchdog. $1 is the harness pid, $2 the CLI pid,
// which is also its process group id. It polls once a second while both are
// alive, then exits when the CLI finished on its own, or terminates the CLI's
// group when the harness went first. It names the group as "-$child" with no
// "--": dash, the /bin/sh of Debian and Ubuntu, reads "--" as a pid and
// refuses it with "Illegal number".
const watchdogScript = `harness="$1"; child="$2"
while kill -0 "$harness" 2>/dev/null && kill -0 "$child" 2>/dev/null; do sleep 1; done
kill -0 "$child" 2>/dev/null || exit 0
kill -TERM "-$child" 2>/dev/null
sleep 5
kill -KILL "-$child" 2>/dev/null
exit 0`

// watchdogName is the name the watchdog shows in ps.
const watchdogName = "claude-code-watchdog"

const defaultWatchdogShell = "/bin/sh"

// ownProcessGroup makes the CLI the leader of its own process group.
func ownProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// signalGroup sends sig to the CLI and everything it spawned, falling back
// to the CLI alone when the group is already gone.
func signalGroup(p *os.Process, sig syscall.Signal) {
	if err := syscall.Kill(-p.Pid, sig); err != nil {
		_ = p.Signal(sig)
	}
}

func terminateGroup(p *os.Process) { signalGroup(p, syscall.SIGTERM) }

func killGroup(p *os.Process) { signalGroup(p, syscall.SIGKILL) }

// watchdogCommand is the watchdog for the CLI childPID of harnessPID. It
// runs in a session of its own, so it neither dies with the harness's
// process group nor keeps the harness's terminal.
func watchdogCommand(shell string, harnessPID, childPID int) *exec.Cmd {
	cmd := exec.Command(shell, "-c", watchdogScript, watchdogName, strconv.Itoa(harnessPID), strconv.Itoa(childPID))
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd
}

// startWatchdog arms the watchdog for a freshly started CLI. A watchdog that
// cannot start (no shell, no process slot) does not fail the turn: the group
// kill on timeout and cancellation still applies.
func startWatchdog(shell string, childPID int) {
	if shell == "" {
		return
	}
	cmd := watchdogCommand(shell, os.Getpid(), childPID)
	if cmd.Start() != nil {
		return
	}
	// Reap it when it exits, within a second of the CLI.
	go func() { _ = cmd.Wait() }()
}

// exitStatus is the CLI's exit code, or -1 and the signal that killed it.
func exitStatus(st *os.ProcessState) (int, string) {
	if ws, ok := st.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		return -1, signalName(ws.Signal())
	}
	return st.ExitCode(), ""
}

// signalName is the conventional name of a signal, like Node reports it.
func signalName(s syscall.Signal) string {
	switch s {
	case syscall.SIGHUP:
		return "SIGHUP"
	case syscall.SIGINT:
		return "SIGINT"
	case syscall.SIGQUIT:
		return "SIGQUIT"
	case syscall.SIGILL:
		return "SIGILL"
	case syscall.SIGTRAP:
		return "SIGTRAP"
	case syscall.SIGABRT:
		return "SIGABRT"
	case syscall.SIGBUS:
		return "SIGBUS"
	case syscall.SIGFPE:
		return "SIGFPE"
	case syscall.SIGKILL:
		return "SIGKILL"
	case syscall.SIGUSR1:
		return "SIGUSR1"
	case syscall.SIGSEGV:
		return "SIGSEGV"
	case syscall.SIGUSR2:
		return "SIGUSR2"
	case syscall.SIGPIPE:
		return "SIGPIPE"
	case syscall.SIGALRM:
		return "SIGALRM"
	case syscall.SIGTERM:
		return "SIGTERM"
	case syscall.SIGXCPU:
		return "SIGXCPU"
	case syscall.SIGXFSZ:
		return "SIGXFSZ"
	}
	return "signal " + strconv.Itoa(int(s))
}
