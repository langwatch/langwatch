package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "A worktree running the idp lane routes it by hostname"
func TestIDPLaneFollowsTheSelection(t *testing.T) {
	plan := func(sel domain.Selection) []Child {
		o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
		st := domain.Stack{Slug: "test", Services: []domain.Service{
			{Name: "idp", Port: 5565, URL: "https://idp.test.langwatch.localhost"},
		}}
		return o.planChildren(st, PlanOptions{Selection: sel}, t.TempDir(), "")
	}
	find := func(children []Child, name string) (Child, bool) {
		for _, c := range children {
			if c.Name == name {
				return c, true
			}
		}
		return Child{}, false
	}

	t.Run("given the default selection", func(t *testing.T) {
		if _, ok := find(plan(domain.DefaultSelection()), "idp"); ok {
			t.Error("the IdP simulator lane was planned without being selected")
		}
	})

	t.Run("given a selection with the idp lane", func(t *testing.T) {
		idp, ok := find(plan(domain.Selection{IDP: true}), "idp")
		if !ok {
			t.Fatal("no idp lane was planned for a selection that asked for one")
		}
		if !strings.Contains(idp.Shell, "svc=idpsim") {
			t.Errorf("the idp lane runs %q, not the idpsim service", idp.Shell)
		}
		var hasAddr, hasBase bool
		for _, e := range idp.Env {
			if e == "SERVER_ADDR=:5565" {
				hasAddr = true
			}
			if e == "IDPSIM_BASE_URL=https://idp.test.langwatch.localhost" {
				hasBase = true
			}
		}
		if !hasAddr {
			t.Errorf("idp env %v lacks its allocated SERVER_ADDR", idp.Env)
		}
		if !hasBase {
			t.Errorf("idp env %v lacks the routed IDPSIM_BASE_URL, so issuer URLs would be loopback", idp.Env)
		}
	})
}

// @scenario "A worktree running the idp lane routes it by hostname"
func TestIDPIsAPlannedHostname(t *testing.T) {
	var found bool
	for _, svc := range domain.PerWorktreeServices {
		if svc.Name == "idp" {
			found = true
		}
	}
	if !found {
		t.Fatal("idp is not in PerWorktreeServices, so provision would never route idp.<slug>")
	}
}
