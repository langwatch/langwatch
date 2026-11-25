package portlessproxy

import (
	"errors"
	"os/exec"
	"syscall"
)

// sig0 probes process existence without delivering a signal.
var sig0 = syscall.Signal(0)

// aliveFromSignalErr interprets the result of Signal(sig0). A nil error means
// the process exists and is ours; EPERM means it exists but is owned by another
// user (portless's proxy runs as a root launchd service after
// `portless service install`), which still counts as alive. Anything else
// (ESRCH, "process already finished") means it is gone.
func aliveFromSignalErr(err error) bool {
	return err == nil || errors.Is(err, syscall.EPERM)
}

// detach puts cmd in a new session so a signal to the caller's process group
// never reaches it.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
