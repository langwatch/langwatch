package fileregistry

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// claimHelperHome, when set, turns this test binary into a daemon stand-in that
// claims the flock under that home, says so, and holds it until killed.
const claimHelperHome = "HAVEN_TEST_CLAIM_HOME"

func TestDaemonClaimHelper(t *testing.T) {
	home := os.Getenv(claimHelperHome)
	if home == "" {
		t.Skip("helper process only")
	}
	claimed, err := New(home).ClaimDaemon(app.DaemonInfo{PID: os.Getpid(), Port: 1})
	if err != nil || !claimed {
		t.Fatalf("helper claim = %v, %v", claimed, err)
	}
	_, _ = os.Stdout.WriteString("claimed\n")
	time.Sleep(time.Minute)
}

// The daemon singleton is an flock held for life (D9): a second daemon defers
// while the first holds it, and claims at once when the first dies, with no
// stale record to clear.
func TestDaemonClaimIsAnFlockHeldForLife(t *testing.T) {
	t.Run("given one daemon holding the claim in this process", func(t *testing.T) {
		home := t.TempDir()
		first, second := New(home), New(home)
		if ok, err := first.ClaimDaemon(app.DaemonInfo{PID: 1, Port: 1}); !ok || err != nil {
			t.Fatalf("first claim = %v, %v", ok, err)
		}
		if ok, err := second.ClaimDaemon(app.DaemonInfo{PID: 2, Port: 2}); ok || err != nil {
			t.Fatalf("second claim while held = %v, %v; want false, nil", ok, err)
		}
		if d, _ := second.Daemon(); d.PID != 1 {
			t.Errorf("the loser touched the record: pid %d", d.PID)
		}
		first.ClearDaemon()
		if ok, err := second.ClaimDaemon(app.DaemonInfo{PID: 2, Port: 2}); !ok || err != nil {
			t.Fatalf("claim after release = %v, %v", ok, err)
		}
		second.ClearDaemon()
	})

	t.Run("given a daemon process that is SIGKILLed", func(t *testing.T) {
		home := t.TempDir()
		cmd := exec.Command(os.Args[0], "-test.run=^TestDaemonClaimHelper$") //nolint:gosec // G204: re-runs this test binary as the daemon
		cmd.Env = append(os.Environ(), claimHelperHome+"="+home)
		out, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := cmd.Start(); err != nil {
			t.Skipf("cannot start a helper process: %v", err)
		}
		t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
		if line, _ := bufio.NewReader(out).ReadString('\n'); line != "claimed\n" {
			t.Fatalf("helper never claimed: %q", line)
		}

		s := New(home)
		if ok, _ := s.ClaimDaemon(app.DaemonInfo{PID: os.Getpid(), Port: 2}); ok {
			t.Fatal("claimed while the helper daemon lives")
		}
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		ok, err := s.ClaimDaemon(app.DaemonInfo{PID: os.Getpid(), Port: 2})
		if !ok || err != nil {
			t.Fatalf("claim after SIGKILL = %v, %v; the kernel should have dropped the lock", ok, err)
		}
		if d, _ := s.Daemon(); d.PID != os.Getpid() {
			t.Errorf("the crashed daemon's record was not replaced: pid %d", d.PID)
		}
		s.ClearDaemon()
	})
}

// SaveStack renames a whole file into place, so a reader racing heartbeats
// never sees a torn entry and drops a live stack.
func TestSaveStackNeverPublishesATornFile(t *testing.T) {
	s := New(t.TempDir())
	st := domain.Stack{Slug: "feat-x", LauncherPID: 42, WorktreeDir: "/wt/feat-x"}
	if err := s.SaveStack(st); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			st.Branch = "branch-" + strconv.Itoa(i)
			_ = s.SaveStack(st)
		}
	}()
	for range 2000 {
		b, err := os.ReadFile(s.stackPath("feat-x"))
		var got domain.Stack
		if err != nil || json.Unmarshal(b, &got) != nil || got.Slug != "feat-x" {
			close(stop)
			wg.Wait()
			t.Fatalf("read a torn entry: err %v, %q", err, b)
		}
	}
	close(stop)
	wg.Wait()
	if left, _ := filepath.Glob(filepath.Join(s.registryDir(), ".tmp-*")); len(left) != 0 {
		t.Errorf("temp files left behind: %v", left)
	}
	if info, _ := os.Stat(s.stackPath("feat-x")); info.Mode().Perm() != 0o600 {
		t.Errorf("entry mode %v, want 0600 (it carries LocalAPIKey)", info.Mode().Perm())
	}
}
