package app

import (
	"context"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func observabilityRouteOrch(obs *fakeObs, routes map[string]int) (*Orchestrator, *tableProxy) {
	proxy := &tableProxy{routes: routes}
	return &Orchestrator{
		cfg:   Config{ShouldStartObservability: true, Naming: domain.DefaultNaming("")},
		store: &fakeStore{}, obs: obs, proxy: proxy, log: zap.NewNop(), sys: &fakeSystem{},
	}, proxy
}

func TestTheDaemonLeavesARouteAlreadyInPlace(t *testing.T) {
	host := domain.DefaultNaming("").Hostname(domain.ObservabilityService, "")
	o, proxy := observabilityRouteOrch(&fakeObs{running: true}, map[string]int{host: 3000})
	for range 3 {
		o.refreshObservability(context.Background())
	}
	if proxy.calls != 0 {
		t.Errorf("registered %d times, want none: the route already points at Grafana", proxy.calls)
	}
}

func TestTheDaemonRoutesObservabilityWhenTheTableDisagrees(t *testing.T) {
	host := domain.DefaultNaming("").Hostname(domain.ObservabilityService, "")
	o, proxy := observabilityRouteOrch(&fakeObs{running: true}, map[string]int{host: 3999})
	o.refreshObservability(context.Background())
	o.refreshObservability(context.Background())
	if proxy.calls != 1 || proxy.Routes()[host] != 3000 {
		t.Errorf("calls = %d, route = %d; want one register to 3000", proxy.calls, proxy.Routes()[host])
	}
}

func TestTheDaemonRemovesOnlyARouteThatExists(t *testing.T) {
	o, proxy := observabilityRouteOrch(&fakeObs{}, map[string]int{})
	o.refreshObservability(context.Background())
	if len(proxy.removed) != 0 {
		t.Errorf("removed %v, want nothing: the table holds no observability route", proxy.removed)
	}
}

func BenchmarkRefreshObservabilityRouted(b *testing.B) {
	host := domain.DefaultNaming("").Hostname(domain.ObservabilityService, "")
	o, _ := observabilityRouteOrch(&fakeObs{running: true}, map[string]int{host: 3000})
	b.ReportAllocs()
	for b.Loop() {
		o.refreshObservability(context.Background())
	}
}
