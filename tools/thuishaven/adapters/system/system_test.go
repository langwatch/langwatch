package system

import (
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
)

// The group signals aim at a pid recorded earlier, and pids get recycled. Sending
// SIGKILL to the group of a recycled pid would kill an unrelated process tree —
// plausibly the developer's own shell — so leadership of the group is the
// identity check that has to hold before any group signal goes out.
func TestOwnsGroup(t *testing.T) {
	t.Run("given a process started the way haven starts its own", func(t *testing.T) {
		cmd := exec.Command("sleep", "30")
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		if err := cmd.Start(); err != nil {
			t.Skipf("cannot start a helper process: %v", err)
		}
		t.Cleanup(func() {
			_ = cmd.Process.Kill()
			_, _ = cmd.Process.Wait()
		})

		t.Run("when its group is checked", func(t *testing.T) {
			t.Run("it leads its own group, so a group signal is safe to send", func(t *testing.T) {
				if !ownsGroup(cmd.Process.Pid) {
					t.Error("a Setpgid child must lead its own group; group signals would be downgraded for every stack")
				}
			})
		})
	})

	t.Run("given a process that did not start its own group", func(t *testing.T) {
		// This test binary was started by `go test`, which does not put it in a
		// group of its own — it stands in for a recycled pid that happens to be
		// alive but is not the process haven recorded.
		if syscall.Getpgrp() == os.Getpid() {
			t.Skip("this test process happens to lead its group")
		}

		t.Run("when its group is checked", func(t *testing.T) {
			t.Run("it is refused, so a stranger's process tree is never signalled", func(t *testing.T) {
				if ownsGroup(os.Getpid()) {
					t.Error("a non-leader was accepted; a recycled pid could take down an unrelated group")
				}
			})
		})
	})

	t.Run("given the pids that would broadcast", func(t *testing.T) {
		t.Run("when they are checked", func(t *testing.T) {
			// kill(-1, …) reaches every process this user can signal, and
			// kill(-0, …) our own group — including haven itself.
			for _, pid := range []int{-1, 0, 1} {
				if ownsGroup(pid) {
					t.Errorf("pid %d was accepted as a group target", pid)
				}
			}
		})
	})
}

func TestTotalMemoryMatchesTheSysctl(t *testing.T) {
	got := System{}.TotalMemory()
	if runtime.GOOS != "darwin" {
		t.Skip("hw.memsize is a darwin sysctl")
	}
	out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		t.Skipf("sysctl unavailable: %v", err)
	}
	want, err := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
	if err != nil || want == 0 {
		t.Fatalf("unreadable sysctl output %q", out)
	}
	if got != want {
		t.Fatalf("TotalMemory() = %d, sysctl says %d", got, want)
	}
}

func TestParseLsofCwdsReadsPidThenPath(t *testing.T) {
	got := parseLsofCwds("p35038\nfcwd\nn/w/tools/dev-runtime\np53235\nfcwd\nn/w2/tools/dev-runtime\n")
	if len(got) != 2 || got[35038] != "/w/tools/dev-runtime" || got[53235] != "/w2/tools/dev-runtime" {
		t.Fatalf("parseLsofCwds = %v", got)
	}
}
