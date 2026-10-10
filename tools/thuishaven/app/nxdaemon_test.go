package app

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func nxDaemonSample(pid int, worktree string) ProcessSample {
	return ProcessSample{PID: pid, RSSBytes: 300 << 20,
		Command: "node " + worktree + "/node_modules/.pnpm/nx@23.2.1/node_modules/nx/dist/src/daemon/server/start.js"}
}

// @scenario "down stops the worktree's Nx daemon and nobody else's"
func TestDownStopsOnlyItsOwnWorktreesNxDaemon(t *testing.T) {
	sup := &fakeSupervisor{}
	o := runOrch(&fakeStore{}, sup)
	o.sys.(*fakeSystem).procSamples = []ProcessSample{nxDaemonSample(11, "/w/other")}

	o.stopNxDaemon(context.Background(), "/w/mine")
	if len(sup.shells) != 0 {
		t.Fatalf("no daemon runs for /w/mine, yet ran %v", sup.shells)
	}

	o.sys.(*fakeSystem).procSamples = append(o.sys.(*fakeSystem).procSamples, nxDaemonSample(12, "/w/mine"))
	o.stopNxDaemon(context.Background(), "/w/mine")
	if !slices.Equal(sup.shells, []string{"./node_modules/.bin/nx daemon --stop >/dev/null"}) || sup.dirs[0] != "/w/mine" {
		t.Fatalf("want one `nx daemon --stop` in /w/mine, got %v in %v", sup.shells, sup.dirs)
	}
}

// @scenario "An Nx daemon whose worktree is gone is reaped"
func TestReapStopsNxDaemonsWhoseWorktreeIsGone(t *testing.T) {
	live := t.TempDir()
	o := runOrch(&fakeStore{}, &fakeSupervisor{})
	sys := o.sys.(*fakeSystem)
	sys.procSamples = []ProcessSample{nxDaemonSample(21, live), nxDaemonSample(22, live+"-deleted")}

	o.reapOrphanNxDaemons()
	if !slices.Equal(sys.terminated, []int{22}) {
		t.Fatalf("want only the orphan (22) stopped, got %v", sys.terminated)
	}
}

// @scenario "An untrusted checkout gets a private Nx cache and no daemon"
func TestEveryPlayLaneCarriesThePrivateNxCache(t *testing.T) {
	root := t.TempDir() // a lockfile and no install stamp: the install lane runs too
	if err := os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), []byte("lockfileVersion: '9.0'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sup := &fakeSupervisor{}
	o := &Orchestrator{sup: sup, log: zap.NewNop()}
	st := domain.Stack{NxPrivateDir: "/home/nx-untrusted/play-1"}

	if err := o.preparePlaySandbox(context.Background(), PlaySandbox{Checkout: root}, st); err != nil {
		t.Fatal(err)
	}
	if len(sup.envs) < 4 {
		t.Fatalf("want install, codegen, prepare and seed lanes, got %v", sup.shells)
	}
	for i, env := range sup.envs {
		if !slices.Contains(env, "NX_DAEMON=false") || !slices.Contains(env, "NX_CACHE_DIRECTORY=/home/nx-untrusted/play-1/cache") {
			t.Errorf("lane %q runs without the private Nx cache: %v", sup.shells[i], env)
		}
	}
}
