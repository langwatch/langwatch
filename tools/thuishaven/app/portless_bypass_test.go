package app

import (
	"context"
	"fmt"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// recordingProxy wraps fakeProxy and records every call a test needs to assert
// never happened under PORTLESS=0.
type recordingProxy struct {
	fakeProxy
	registered   []string
	installCalls int
	ensureCalls  int
}

func (p *recordingProxy) Installed() bool {
	p.installCalls++
	return false // force ensurePortlessProxy down the Install() branch too
}

func (p *recordingProxy) Install() error {
	p.installCalls++
	return nil
}

func (p *recordingProxy) EnsureReady() error {
	p.ensureCalls++
	return nil
}

func (p *recordingProxy) Register(service, slug string, port int) error {
	p.registered = append(p.registered, service+"."+slug)
	return nil
}

func serviceByName(services []domain.Service, name string) (domain.Service, bool) {
	for _, s := range services {
		if s.Name == name {
			return s, true
		}
	}
	return domain.Service{}, false
}

// PORTLESS=0 is haven's documented escape hatch for a machine where the
// portless proxy's TLS handshake won't come up (#7117): before this, the flag
// was documented in `haven help env` but nothing read it, so `up` always
// bootstrapped and routed through the proxy regardless.
//
// @scenario "PORTLESS=0 bypasses the proxy bootstrap on up"
func TestPortlessBypassSkipsProxyBootstrap(t *testing.T) {
	proxy := &recordingProxy{}
	o := &Orchestrator{cfg: Config{PortlessDisabled: true}, proxy: proxy}

	if err := o.ensurePortlessProxy(); err != nil {
		t.Fatalf("ensurePortlessProxy: %v", err)
	}
	if proxy.installCalls != 0 {
		t.Errorf("PORTLESS=0 must never check/install portless, got %d calls", proxy.installCalls)
	}
	if proxy.ensureCalls != 0 {
		t.Errorf("PORTLESS=0 must never start/trust the proxy, got %d calls", proxy.ensureCalls)
	}
}

// @scenario "Portless enabled still bootstraps the proxy on up"
func TestPortlessEnabledStillBootstrapsProxy(t *testing.T) {
	proxy := &recordingProxy{}
	o := &Orchestrator{cfg: Config{PortlessDisabled: false}, proxy: proxy}

	if err := o.ensurePortlessProxy(); err != nil {
		t.Fatalf("ensurePortlessProxy: %v", err)
	}
	if proxy.installCalls == 0 {
		t.Error("portless enabled must still check/install the proxy")
	}
	if proxy.ensureCalls != 1 {
		t.Errorf("portless enabled must start/trust the proxy exactly once, got %d", proxy.ensureCalls)
	}
}

// @scenario "PORTLESS=0 serves the app directly over HTTP on its own port"
// @scenario "PORTLESS=0 never registers a hostname with the proxy"
func TestPortlessBypassProvisionsDirectHTTP(t *testing.T) {
	store := &fakeStore{slugCache: map[string]string{"/wt/x": "x"}}
	sys := &playPortSystem{}
	proxy := &recordingProxy{}
	o := &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming(""), PortlessDisabled: true},
		store: store, sys: sys, proxy: proxy, log: zap.NewNop(),
	}
	p := UpParams{WorktreeDir: "/wt/x", IsLinkedWorktree: true, Branch: "x"}

	st, cleanup, err := o.provision(context.Background(), p, PlanOptions{Selection: domain.DefaultSelection()}, false)
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	defer cleanup()

	app, ok := serviceByName(st.Services, "app")
	if !ok {
		t.Fatal("no app service in the provisioned stack")
	}
	if app.Port == 0 {
		t.Fatal("app service was provisioned with no port")
	}
	wantURL := fmt.Sprintf("http://app.%s.langwatch.localhost:%d", st.Slug, app.Port)
	if app.URL != wantURL {
		t.Errorf("app URL = %q, want %q — plain http on its own loopback port, no shared proxy port", app.URL, wantURL)
	}
	if len(proxy.registered) != 0 {
		t.Errorf("no service should be registered with the proxy under PORTLESS=0, got %v", proxy.registered)
	}

	cleanup()
	if len(proxy.registered) != 0 {
		t.Errorf("teardown must not touch the proxy under PORTLESS=0 either, got %v", proxy.registered)
	}
}

// Portless enabled is the existing, unchanged behavior: every routed service
// shares the proxy's own scheme+port, addressed by hostname.
//
// @scenario "Portless enabled routes services through the shared proxy endpoint"
func TestPortlessEnabledProvisionsThroughProxy(t *testing.T) {
	store := &fakeStore{slugCache: map[string]string{"/wt/x": "x"}}
	sys := &playPortSystem{}
	proxy := &recordingProxy{}
	o := &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming(""), PortlessDisabled: false},
		store: store, sys: sys, proxy: proxy, log: zap.NewNop(),
	}
	p := UpParams{WorktreeDir: "/wt/x", IsLinkedWorktree: true, Branch: "x"}

	st, cleanup, err := o.provision(context.Background(), p, PlanOptions{Selection: domain.DefaultSelection()}, false)
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	defer cleanup()

	app, ok := serviceByName(st.Services, "app")
	if !ok {
		t.Fatal("no app service in the provisioned stack")
	}
	wantScheme, wantPort := proxy.Endpoint()
	wantURL := o.cfg.Naming.URL("app", st.Slug, wantScheme, wantPort)
	if app.URL != wantURL {
		t.Errorf("app URL = %q, want %q — the shared proxy endpoint, not the app's own port", app.URL, wantURL)
	}
	if len(proxy.registered) == 0 {
		t.Error("services must be registered with the proxy when portless is enabled")
	}
}

// PORTLESS is a machine/run-level knob (Config), not part of the per-stack
// Selection reconcileRunningStack otherwise compares — flipping it on an
// already-running stack must still trigger a restart, or the escape hatch is a
// no-op for the most likely real journey: a stack is already up under a broken
// proxy, the operator sets PORTLESS=0, and `haven up` reports "nothing to do".
//
// @scenario "A stack provisioned under one PORTLESS setting restarts when the setting flips"
func TestReconcileDetectsPortlessSettingChange(t *testing.T) {
	store := &fakeStore{
		stacks:    []domain.Stack{{Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: 42, PortlessDisabled: false}},
		slugCache: map[string]string{"/wt/feat-x": "feat-x"},
	}
	sys := &fakeSystem{alive: map[int]bool{42: true}}
	o := &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming(""), PortlessDisabled: true},
		store: store, sys: sys, proxy: &fakeProxy{}, log: zap.NewNop(),
	}
	p := UpParams{WorktreeDir: "/wt/feat-x", IsLinkedWorktree: true}

	proceed, err := o.reconcileRunningStack(p, PlanOptions{Selection: domain.SelectionFromStack(store.stacks[0])})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if !proceed {
		t.Error("a PORTLESS setting change must re-provision, not report a no-op")
	}
	if len(sys.terminated) != 1 || sys.terminated[0] != 42 {
		t.Errorf("the old launcher must be terminated, got %v", sys.terminated)
	}
}

// @scenario "PORTLESS=0 serves ClickHouse directly over HTTP on its own port"
func TestPortlessBypassEnsureClickHouseServesDirectHTTP(t *testing.T) {
	proxy := &recordingProxy{}
	o := &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming(""), PortlessDisabled: true, ShouldManageClickHouse: true},
		ch:    &fakeDBServer{},
		proxy: proxy, log: zap.NewNop(),
	}
	st := &domain.Stack{Slug: "x"}

	o.ensureClickHouse(context.Background(), st)

	ch, ok := serviceByName(st.Services, domain.ClickHouseService)
	if !ok {
		t.Fatal("no clickhouse service recorded")
	}
	wantURL := o.cfg.Naming.URL(domain.ClickHouseService, "x", "http", ch.Port)
	if ch.URL != wantURL {
		t.Errorf("clickhouse URL = %q, want %q — plain http on its own port, no shared proxy port", ch.URL, wantURL)
	}
	if len(proxy.registered) != 0 {
		t.Errorf("clickhouse must not be registered with the proxy under PORTLESS=0, got %v", proxy.registered)
	}
}

// @scenario "Portless enabled routes ClickHouse through the shared proxy endpoint"
func TestPortlessEnabledEnsureClickHouseRoutesThroughProxy(t *testing.T) {
	proxy := &recordingProxy{}
	o := &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming(""), PortlessDisabled: false, ShouldManageClickHouse: true},
		ch:    &fakeDBServer{},
		proxy: proxy, log: zap.NewNop(),
	}
	st := &domain.Stack{Slug: "x"}

	o.ensureClickHouse(context.Background(), st)

	ch, ok := serviceByName(st.Services, domain.ClickHouseService)
	if !ok {
		t.Fatal("no clickhouse service recorded")
	}
	wantScheme, wantPort := proxy.Endpoint()
	wantURL := o.cfg.Naming.URL(domain.ClickHouseService, "x", wantScheme, wantPort)
	if ch.URL != wantURL {
		t.Errorf("clickhouse URL = %q, want %q — the shared proxy endpoint, not its own port", ch.URL, wantURL)
	}
	if len(proxy.registered) == 0 {
		t.Error("clickhouse must be registered with the proxy when portless is enabled")
	}
}
