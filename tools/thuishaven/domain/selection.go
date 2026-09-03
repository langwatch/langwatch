package domain

import (
	"fmt"
	"strings"
)

// Selection is a worktree's sticky service choice (ADR-064): which optional
// services `haven up` runs here. The three Node lanes — ui, api and workers —
// always run and are not selectable. Expressed as deltas on up (`haven up
// +langy`, `haven up -nlp`), persisted per worktree, shown by status. The zero
// value is NOT a fresh worktree's default — that is DefaultSelection.
type Selection struct {
	Gateway bool `json:"gateway"`
	NLP     bool `json:"nlp"`
	// Langy is off by default: it costs a container image and a hard memory
	// cap that most worktrees never exercise. The worktrees that need it say
	// `haven up +langy` once.
	Langy bool `json:"langy"`
	// IDP is on by default: the identity-provider simulator (OIDC + SAML +
	// SCIM + domain verification) is one small Go process, and having a
	// login-capable IdP always routed makes identity flows testable without a
	// setup step. Worktrees that don't want it say `haven up -idp` once.
	// `haven idp` runs the simulator alone, with no stack at all.
	IDP bool `json:"idp"`
}

// DefaultSelection is a fresh worktree's lean default: the three Node lanes,
// gateway, nlp and the idp simulator — no langy.
func DefaultSelection() Selection { return Selection{Gateway: true, NLP: true, IDP: true} }

// SelectableServices are the names ±deltas accept, in display order.
var SelectableServices = []string{"gateway", "nlp", "langy", "idp"}

// RetiredSelectionServices are ±names that used to pick something and no longer
// can, with what to say instead. `workers` was the choice between a standalone
// worker lane and hosting the queue stack inside the app process; the worker is
// its own application now, so the lane always runs and there is nothing left to
// select. Refused by name rather than falling into the generic "unknown
// service" error, which would read as a typo.
var RetiredSelectionServices = map[string]string{
	"workers": "the background worker is its own process now — every stack runs the ui, api and workers lanes, so there is nothing to select",
}

// ApplySelectionDeltas folds `+svc` / `-svc` arguments into a selection.
func ApplySelectionDeltas(sel Selection, deltas []string) (Selection, error) {
	for _, d := range deltas {
		if len(d) < 2 || (d[0] != '+' && d[0] != '-') {
			return sel, fmt.Errorf("unrecognised argument %q — services are picked with +service or -service (services: %s)", d, strings.Join(SelectableServices, ", "))
		}
		on := d[0] == '+'
		if note, retired := RetiredSelectionServices[d[1:]]; retired {
			return sel, fmt.Errorf("%q no longer selects anything — %s", d[1:], note)
		}
		switch d[1:] {
		case "gateway":
			sel.Gateway = on
		case "nlp":
			sel.NLP = on
		case "langy":
			sel.Langy = on
		case "idp":
			sel.IDP = on
		default:
			return sel, fmt.Errorf("unknown service %q — services: %s", d[1:], strings.Join(SelectableServices, ", "))
		}
	}
	return sel, nil
}

// SelectionFromStack derives what a running stack actually runs, so a plain
// `up` can tell "already matches the selection" from "needs a restart".
func SelectionFromStack(st Stack) Selection {
	var sel Selection
	for _, svc := range st.Services {
		local := svc.Port != 0 && !svc.IsFallback
		switch svc.Name {
		case "gateway":
			sel.Gateway = local
		case "nlp":
			sel.NLP = local
		case "langyagent":
			sel.Langy = local
		case "idp":
			sel.IDP = local
		}
	}
	return sel
}

// CLIServiceName maps an internal service name to its CLI spelling — the CLI
// says langy, never langyagent (ADR-064: one name), and it says ui for the
// routed `app` hostname, which is the browser application's lane. The hostname
// keeps the name app.<slug> because the API is served under it at /api; the
// LANE is the Vite process alone, and `haven logs ui` / `haven restart ui`
// must name the same thing the supervisor labels.
func CLIServiceName(internal string) string {
	switch internal {
	case "langyagent":
		return "langy"
	case "app":
		return "ui"
	default:
		return internal
	}
}

// Describe renders the selection for humans: what runs, what is off, and the
// exact delta that adds it.
func (s Selection) Describe() string {
	on := []string{"ui", "api", "workers"}
	var off []string
	add := func(enabled bool, name string) {
		if enabled {
			on = append(on, name)
			return
		}
		off = append(off, fmt.Sprintf("%s (haven up +%s)", name, name))
	}
	add(s.Gateway, "gateway")
	add(s.NLP, "nlp")
	add(s.Langy, "langy")
	add(s.IDP, "idp")
	out := "services: " + strings.Join(on, " · ")
	if len(off) > 0 {
		out += "   off: " + strings.Join(off, " · ")
	}
	return out
}
