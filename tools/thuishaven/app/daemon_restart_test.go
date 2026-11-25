package app

import (
	"slices"
	"testing"
)

// restartStore reports the old daemon until it is terminated, then its successor.
type restartStore struct {
	*fakeStore
	sys       *fakeSystem
	old, next DaemonInfo
}

func (s restartStore) Daemon() (DaemonInfo, bool) {
	if slices.Contains(s.sys.terminated, s.old.PID) {
		return s.next, true
	}
	return s.old, true
}

func TestRestartDaemonStartsASuccessorAndSignalsOnlyTheOldDaemon(t *testing.T) {
	sys := &fakeSystem{
		alive:      map[int]bool{77: true, 78: true, 42: true},
		portsInUse: map[int]bool{7000: true, 7001: true},
	}
	store := &fakeStore{}
	o := hubOrchestrator(store, sys, &fakeProxy{}, &fakeDBServer{}, &fakeDBServer{}, &fakeHygiene{})
	o.cfg.DaemonArgv = []string{"/bin/haven", "daemon"}
	o.store = restartStore{fakeStore: store, sys: sys, old: DaemonInfo{PID: 77, Port: 7000}, next: DaemonInfo{PID: 78, Port: 7001}}

	pid, err := o.RestartDaemon("/repo")
	if err != nil || pid != 78 {
		t.Fatalf("RestartDaemon = %d, %v; want the successor's pid 78", pid, err)
	}
	if len(sys.spawned) != 1 || !slices.Equal(sys.spawned[0].Argv, []string{"/bin/haven", "daemon", "--after", "77"}) {
		t.Errorf("spawned %v; want one successor waiting for 77", sys.spawned)
	}
	if !slices.Equal(sys.terminated, []int{77}) || len(sys.groupTerminated)+len(sys.groupKilled) != 0 {
		t.Errorf("terminated %v, groups %v %v; a restart signals the old daemon alone, never a stack", sys.terminated, sys.groupTerminated, sys.groupKilled)
	}
}

// contendedStore loses the daemon claim until its predecessor lets go.
type contendedStore struct {
	*fakeStore
	refusals *int
}

func (s contendedStore) ClaimDaemon(DaemonInfo) (bool, error) {
	if *s.refusals > 0 {
		*s.refusals--
		return false, nil
	}
	return true, nil
}

func TestASuccessorWaitsForItsPredecessorsLockButAFreshDaemonDoesNot(t *testing.T) {
	refusals := 2
	o := hubOrchestrator(&fakeStore{}, &fakeSystem{}, &fakeProxy{}, &fakeDBServer{}, &fakeDBServer{}, &fakeHygiene{})
	o.store = contendedStore{fakeStore: &fakeStore{}, refusals: &refusals}
	if claimed, _ := o.claimDaemon(t.Context(), DaemonInfo{}, 77); !claimed || refusals != 0 {
		t.Errorf("successor claimed=%v with %d refusals left; want it to retry until the lock frees", claimed, refusals)
	}
	refusals = 1
	if claimed, _ := o.claimDaemon(t.Context(), DaemonInfo{}, 0); claimed {
		t.Error("a fresh daemon retried the claim; it must defer at once to the running one")
	}
}
