package app

import (
	"context"
	"slices"
	"strconv"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// homeProxy records every route registered, as "<route name>:<port>".
type homeProxy struct {
	fakeProxy
	registered []string
}

func (p *homeProxy) Register(service, slug string, port int) error {
	p.registered = append(p.registered, domain.DefaultNaming("").RouteName(service, slug)+":"+strconv.Itoa(port))
	return nil
}

// daemonStore is a fakeStore with a daemon listening on port 7000.
type daemonStore struct{ *fakeStore }

func (d daemonStore) Daemon() (DaemonInfo, bool) { return DaemonInfo{PID: 1, Port: 7000}, true }

func homeOrchestrator(proxy *homeProxy, store *fakeStore) *Orchestrator {
	o := hubOrchestrator(store, &fakeSystem{alive: map[int]bool{42: true}}, &proxy.fakeProxy, &fakeDBServer{}, &fakeDBServer{},
		&fakeHygiene{worktrees: []Worktree{{Dir: "/repos/langwatch"}, {Dir: "/repos/wt/feat-x"}, {Dir: "/repos/wt/parked"}}})
	o.proxy = proxy
	o.store = daemonStore{store}
	o.cfg.RepoRoot = "/repos/langwatch"
	return o
}

func homeStore() *fakeStore {
	return &fakeStore{
		stacks: []domain.Stack{
			{Slug: "feat-x", WorktreeDir: "/repos/wt/feat-x", LauncherPID: 42, Services: []domain.Service{{Name: "app"}}},
			{Slug: "hub", WorktreeDir: "/repos/wt/hub", LauncherPID: 43},
		},
		slugCache: map[string]string{"/repos/wt/parked": "parked"},
	}
}

func TestDaemonRoutesEveryStackHome(t *testing.T) {
	proxy := &homeProxy{}
	o := homeOrchestrator(proxy, homeStore())
	o.routeStackHomes(7000)
	want := []string{"feat-x.langwatch:7000", "parked.langwatch:7000"}
	if !slices.Equal(proxy.registered, want) {
		t.Errorf("registered %v, want %v: every registered stack and every named worktree, never a machine-wide name", proxy.registered, want)
	}
	o.unrouteStackHomes()
	if !slices.Contains(proxy.removed, "feat-x.") || !slices.Contains(proxy.removed, "parked.") {
		t.Errorf("the daemon's exit must take the homes with it, removed %v", proxy.removed)
	}
}

func TestUpRoutesTheHomeToTheDaemon(t *testing.T) {
	proxy := &homeProxy{}
	o := homeOrchestrator(proxy, homeStore())
	o.registerStackHomeWithDaemon("feat-x")
	if !slices.Equal(proxy.registered, []string{"feat-x.langwatch:7000"}) {
		t.Errorf("registered %v, want the home at the daemon's port", proxy.registered)
	}
	o.cfg.PortlessDisabled = true
	proxy.registered = nil
	o.registerStackHomeWithDaemon("feat-x")
	if len(proxy.registered) != 0 {
		t.Errorf("PORTLESS=0 routes nothing, registered %v", proxy.registered)
	}
}

func TestAStoppedStackKeepsItsHomeAndAPrunedOneLosesIt(t *testing.T) {
	proxy := &homeProxy{}
	o := homeOrchestrator(proxy, homeStore())
	if err := o.DownStack(context.Background(), "feat-x"); err != nil {
		t.Fatal(err)
	}
	if slices.Contains(proxy.removed, "feat-x.") {
		t.Fatalf("down removed the home %v; it must answer while the stack is stopped", proxy.removed)
	}
	if err := o.DestroyStack(context.Background(), "feat-x"); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(proxy.removed, "feat-x.") {
		t.Errorf("destroying the stack must take its home away, removed %v", proxy.removed)
	}
}
