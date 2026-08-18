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
	o := &Orchestrator{cfg: Config{ShouldUsePortless: false}, proxy: proxy}

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
	o := &Orchestrator{cfg: Config{ShouldUsePortless: true}, proxy: proxy}

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
		cfg:   Config{Naming: domain.DefaultNaming(""), ShouldUsePortless: false},
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
		cfg:   Config{Naming: domain.DefaultNaming(""), ShouldUsePortless: true},
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
