package system

import (
	"os"
	"os/exec"
	"testing"
)

// ProcessStart is half of a process's identity (D6): stable for one process,
// and empty once the process is gone, so a reused pid can never match it.
func TestProcessStart(t *testing.T) {
	sys := New()
	t.Run("a live process reads the same start twice", func(t *testing.T) {
		first := sys.ProcessStart(os.Getpid())
		if first == "" {
			t.Skip("ps cannot read a start time here")
		}
		if again := sys.ProcessStart(os.Getpid()); again != first {
			t.Errorf("start moved: %q then %q", first, again)
		}
	})

	t.Run("a process that has exited reads no start", func(t *testing.T) {
		cmd := exec.Command("true")
		if err := cmd.Run(); err != nil {
			t.Skipf("cannot run a helper process: %v", err)
		}
		if got := sys.ProcessStart(cmd.Process.Pid); got != "" {
			t.Errorf("exited pid %d reads start %q", cmd.Process.Pid, got)
		}
	})

	t.Run("no pid reads no start", func(t *testing.T) {
		if got := sys.ProcessStart(0); got != "" {
			t.Errorf("pid 0 reads %q", got)
		}
	})
}
