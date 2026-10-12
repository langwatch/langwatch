//go:build !unix

package claudecode

import (
	"os"
	"os/exec"
)

// Process groups and the watchdog are POSIX. Elsewhere the CLI is started
// plainly and killed alone; Call still never returns while it runs.

const defaultWatchdogShell = ""

func ownProcessGroup(*exec.Cmd) {}

func terminateGroup(p *os.Process) { _ = p.Kill() }

func killGroup(p *os.Process) { _ = p.Kill() }

// groupAlive is false: without process groups, only the CLI is tracked.
func groupAlive(*os.Process) bool { return false }

func startWatchdog(string, int) {}

func exitStatus(st *os.ProcessState) (int, string) { return st.ExitCode(), "" }
