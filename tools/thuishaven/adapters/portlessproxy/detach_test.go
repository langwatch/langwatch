package portlessproxy

import (
	"os/exec"
	"testing"
)

// @scenario "Reloading and restarting the daemon leave the shared proxy running"
func TestDetachGivesTheCommandItsOwnSession(t *testing.T) {
	cmd := exec.Command("true")
	detach(cmd)
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.Setsid {
		t.Fatal("every portless invocation must start in its own session so a proxy it starts outlives the caller's group")
	}
}
