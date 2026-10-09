package app

import (
	"sync"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const (
	waitDaemonPort = 7000
	waitAppPort    = 9000
	appHost        = "app.feat-x.langwatch.localhost"
)

// tableProxy is fakeProxy with a route table that Register writes to.
type tableProxy struct {
	fakeProxy
	mu     sync.Mutex
	routes map[string]int
	calls  int
}

func (p *tableProxy) Routes() map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := map[string]int{}
	for k, v := range p.routes {
		out[k] = v
	}
	return out
}

func (p *tableProxy) Register(service, slug string, port int) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls++
	p.routes[domain.DefaultNaming("").Hostname(service, slug)] = port
	return nil
}

func waitOrch(routePort int, launcherAlive, appUp bool) (*Orchestrator, *tableProxy) {
	proxy := &tableProxy{routes: map[string]int{appHost: routePort}}
	store := &fakeStore{stacks: []domain.Stack{{
		Slug: "feat-x", LauncherPID: 42,
		Services: []domain.Service{{Name: "app", Port: waitAppPort}},
	}}}
	sys := &fakeSystem{alive: map[int]bool{42: launcherAlive}, portsInUse: map[int]bool{waitAppPort: appUp}}
	return &Orchestrator{cfg: Config{Naming: domain.DefaultNaming("")}, store: store, sys: sys, proxy: proxy, log: zap.NewNop()}, proxy
}

// @scenario "a down service's route is pointed at the daemon"
func TestWaitRoutesPointADownServiceAtTheDaemon(t *testing.T) {
	o, proxy := waitOrch(waitAppPort, true, false)
	o.reconcileWaitRoutes(waitDaemonPort, false)
	if got := proxy.routes[appHost]; got != waitDaemonPort {
		t.Errorf("app route = %d, want the daemon's %d", got, waitDaemonPort)
	}
}

// @scenario "the route goes back once the service listens"
func TestWaitRoutesGiveTheRouteBackOnceUp(t *testing.T) {
	o, proxy := waitOrch(waitDaemonPort, true, true)
	o.reconcileWaitRoutes(waitDaemonPort, false)
	if got := proxy.routes[appHost]; got != waitAppPort {
		t.Errorf("app route = %d, want the app's %d", got, waitAppPort)
	}
}

// @scenario "a route haven did not set is left alone"
func TestWaitRoutesLeaveAForeignRouteAlone(t *testing.T) {
	o, proxy := waitOrch(9999, true, false)
	o.reconcileWaitRoutes(waitDaemonPort, false)
	if proxy.calls != 0 || proxy.routes[appHost] != 9999 {
		t.Errorf("a route at another port was moved: %v after %d calls", proxy.routes, proxy.calls)
	}
}

// @scenario "a stack whose launcher is gone is left to the reaper"
func TestWaitRoutesSkipAStackWhoseLauncherIsGone(t *testing.T) {
	o, proxy := waitOrch(waitAppPort, false, false)
	o.reconcileWaitRoutes(waitDaemonPort, false)
	if proxy.calls != 0 {
		t.Errorf("a dead stack's route was moved: %v", proxy.routes)
	}
}

// @scenario "the daemon gives the routes back when it exits"
func TestWaitRoutesGoBackWhenTheDaemonLeaves(t *testing.T) {
	o, proxy := waitOrch(waitDaemonPort, true, false)
	o.reconcileWaitRoutes(waitDaemonPort, true)
	if got := proxy.routes[appHost]; got != waitAppPort {
		t.Errorf("app route = %d after the daemon left, want the app's %d", got, waitAppPort)
	}
}
