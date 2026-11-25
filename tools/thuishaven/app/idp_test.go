package app

import (
	"path/filepath"
	"slices"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// routingProxy is a live proxy fake: routes register, and the endpoint is the
// standard https:443, so the solo runner hands the simulator its routed URL.
type routingProxy struct {
	stubProxy
	registered []string
	removed    []string
}

func (p *routingProxy) Register(service, slug string, _ int) error {
	p.registered = append(p.registered, service+"|"+slug)
	return nil
}
func (p *routingProxy) Remove(service, slug string) { p.removed = append(p.removed, service+"|"+slug) }
func (p *routingProxy) Running() bool               { return true }

// @scenario "The simulator runs alone without the app stack"
func TestRunIdPSoloRunsOnlyTheSimulator(t *testing.T) {
	sup := &fakeSupervisor{}
	proxy := &routingProxy{}
	o := &Orchestrator{
		cfg:   Config{RepoRoot: "/repo", Home: t.TempDir(), Naming: domain.DefaultNaming(""), SimulatorArgv: []string{"/bin/haven", "simulator"}},
		sys:   &fakeSystem{},
		sup:   sup,
		proxy: proxy,
		log:   zap.NewNop(),
	}

	if err := o.RunIdPSolo(t.Context(), 7); err != nil {
		t.Fatalf("RunIdPSolo: %v", err)
	}
	if !slices.Contains(sup.envs[0], "IDPSIM_DATA_DIR="+filepath.Join(o.cfg.Home, "idp-standalone")) {
		t.Errorf("standalone IdP env lacks its separate persistent directory: %v", sup.envs[0])
	}

	t.Run("runs exactly one process, the simulator", func(t *testing.T) {
		if len(sup.shells) != 1 || sup.shells[0] != "exec '/bin/haven' 'simulator' 'idp'" {
			t.Fatalf("ran %v, want a single idpsim run — no app, api, workers or databases", sup.shells)
		}
	})
	t.Run("routes the machine-wide idp hostname and removes it on exit", func(t *testing.T) {
		if len(proxy.registered) != 1 || proxy.registered[0] != "idp|" {
			t.Errorf("registered %v, want the slugless idp route", proxy.registered)
		}
		if len(proxy.removed) != 1 || proxy.removed[0] != "idp|" {
			t.Errorf("removed %v, want the route deregistered on exit", proxy.removed)
		}
	})
	t.Run("hands the simulator its routed base URL and tenant range", func(t *testing.T) {
		var hasBase, hasTenants bool
		for _, e := range sup.envs[0] {
			if e == "IDPSIM_BASE_URL=https://idp.langwatch.localhost" {
				hasBase = true
			}
			if e == "IDPSIM_TENANTS=7" {
				hasTenants = true
			}
		}
		if !hasBase {
			t.Errorf("env %v lacks the routed IDPSIM_BASE_URL, so issuer URLs would be loopback", sup.envs[0])
		}
		if !hasTenants {
			t.Errorf("env %v lacks the requested tenant range", sup.envs[0])
		}
	})
}
