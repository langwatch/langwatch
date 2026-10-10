package app

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// waitGrace is how long a service's port stays down before its route moves to
// the wait page: a Vite or in-process backend restart comes back inside it, and
// the browser's own HMR reconnect then reloads the app, not the wait page.
const waitGrace = 20 * time.Second

// routeTable is the proxy's live hostname -> port table. portless keeps one;
// a proxy that does not leaves every route where `up` put it.
type routeTable interface {
	Routes() map[string]int
}

// waitRouteLoop re-points a live stack's routes at the daemon's wait page while
// their service does not answer (portless has no error-page hook), and gives
// them back as the daemon leaves (RunDaemon's defer). Spec: specs/setup/haven-wait-page.feature.
func (o *Orchestrator) waitRouteLoop(ctx context.Context, daemonPort int) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			o.reconcileWaitRoutes(daemonPort, false)
		}
	}
}

// reconcileWaitRoutes moves only routes haven set: one at the service's own
// port while it is down goes to the daemon, one at the daemon goes back once
// the service listens (or the daemon is leaving). Any other port is left alone.
func (o *Orchestrator) reconcileWaitRoutes(daemonPort int, leaving bool) {
	table, ok := o.proxy.(routeTable)
	if !ok || daemonPort == 0 || o.cfg.PortlessDisabled {
		return
	}
	pass := waitPass{routes: table.Routes(), daemonPort: daemonPort, leaving: leaving}
	stacks := o.store.Stacks()
	var calls []func()
	for i := range stacks {
		st := &stacks[i]
		if st.PortlessDisabled || !o.launcherIsOurs(*st) {
			continue
		}
		for j := range st.Services {
			calls = append(calls, o.waitMoves(pass, st.Slug, &st.Services[j])...)
		}
	}
	inParallel(calls)
}

// waitPass is one reconcile's inputs: the proxy's table read once, and whether
// the daemon is leaving (every route goes back).
type waitPass struct {
	routes     map[string]int
	daemonPort int
	leaving    bool
}

// waitMoves are the route moves one service needs, under its name and aliases.
func (o *Orchestrator) waitMoves(pass waitPass, slug string, svc *domain.Service) []func() {
	if svc.Port == 0 || svc.IsFallback || svc.Name == domain.ClickHouseService || svc.Name == domain.PostgresService {
		return nil
	}
	up := pass.leaving || o.sys.PortInUse(svc.Port)
	waiting := !up && o.downPastGrace(slug+"/"+svc.Name)
	if up {
		delete(o.waitDownSince, slug+"/"+svc.Name)
	}
	var moves []func()
	for _, name := range append([]string{svc.Name}, domain.ServiceHostAliases[svc.Name]...) {
		port, has := pass.routes[o.cfg.Naming.Hostname(name, slug)]
		switch {
		case has && port == svc.Port && waiting:
			moves = append(moves, o.registerRoute(name, slug, pass.daemonPort))
		case has && port == pass.daemonPort && up:
			moves = append(moves, o.registerRoute(name, slug, svc.Port))
		}
	}
	return moves
}

// downPastGrace records when key was first seen down and answers whether that
// was waitGrace ago or more. A port seen up clears it (see waitMoves).
func (o *Orchestrator) downPastGrace(key string) bool {
	if o.waitDownSince == nil {
		o.waitDownSince = map[string]time.Time{}
	}
	since, seen := o.waitDownSince[key]
	if !seen {
		since = o.sys.Now()
		o.waitDownSince[key] = since
	}
	return o.sys.Now().Sub(since) >= waitGrace
}
