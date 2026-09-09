package domain

import (
	"fmt"
	"strings"
)

// Selection is a worktree's sticky service choice (ADR-064): which optional
// services `haven up` runs here. The two Node lanes — ui and backend — always
// run and are not selectable. Gateway and NLP still select individually; both
// are hosted by the one `go` lane. Expressed as deltas on up (`haven up
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
	// DesignSystem is the design system's component workshop, off by default:
	// it is a developer's tool rather than a part of the product, and the
	// worktrees that never open it should not pay for the build. A worktree
	// doing design work says `haven up +design-system` once. With the lane on,
	// the ui lane frames THIS Storybook at /design-system instead of starting
	// a second one (see Stack.OverlayEnv's LANGWATCH_STORYBOOK_PORT).
	DesignSystem bool `json:"design-system"`
	// MailRoom is the studio that renders every transactional message the
	// product sends. Off by default for the same reason as DesignSystem: it is
	// a tool for the person writing an email template, not a service the
	// application talks to, so nothing else in the stack degrades without it.
	MailRoom bool `json:"mail-room"`
}

// DefaultSelection is a fresh worktree's lean default: the two Node lanes,
// gateway, nlp and the idp simulator — no langy, and neither of the two
// developer tools (design-system, mail-room).
func DefaultSelection() Selection { return Selection{Gateway: true, NLP: true, IDP: true} }

// SelectableServices are the names ±deltas accept, in display order.
var SelectableServices = []string{"gateway", "nlp", "langy", "idp", "design-system", "mail-room"}

// RetiredSelectionServices are ±names that no longer pick what they used to,
// with the full sentence to say instead. `workers` was the choice between a
// standalone worker lane and hosting the queue stack inside the app process;
// the worker is its own application now, so the lane always runs and there is
// nothing left to select. `storybook` and `mail` are the pre-rename spellings
// of the two developer-tool lanes — refused the same way, naming the flag that
// replaced each one rather than pretending it still works. Refused by name
// rather than falling into the generic "unknown service" error, which would
// read as a typo.
var RetiredSelectionServices = map[string]string{
	"workers":   "no longer selects anything — the worker runs in the backend lane locally and as its own deployment in production — every stack runs the ui and backend lanes, so there is nothing to select",
	"api":       "no longer selects anything — the api runs in the backend lane, which every stack runs",
	"backend":   "is not selectable — every stack runs the backend lane, or it would serve pages and process no jobs",
	"storybook": "was renamed — use +design-system / -design-system",
	"mail":      "was renamed — use +mail-room / -mail-room",
}

// MonolithRetiredSelectionServices are the ±names refused on a monolith
// checkout, on top of the ones refused everywhere: it has neither application
// package, so `ui` and `backend` name nothing there. Refused by name, like
// `api`, rather than as a typo, because it is the layout that decides.
var MonolithRetiredSelectionServices = map[string]string{
	"ui":      "is not a lane of this checkout - it runs one app lane, which serves the browser application and its API together",
	"backend": "is not a lane of this checkout - it runs one app lane, which serves the browser application and its API together",
}

// ApplySelectionDeltas folds `+svc` / `-svc` arguments into a selection.
func ApplySelectionDeltas(sel Selection, deltas []string) (Selection, error) {
	return ApplySelectionDeltasForLayout(sel, deltas, LayoutModular)
}

// ApplySelectionDeltasForLayout is ApplySelectionDeltas against a known
// layout, so a lane name that does not exist in this checkout is refused by
// name rather than accepted and then silently not planned.
func ApplySelectionDeltasForLayout(sel Selection, deltas []string, layout Layout) (Selection, error) {
	for _, d := range deltas {
		if len(d) < 2 || (d[0] != '+' && d[0] != '-') {
			return sel, fmt.Errorf("unrecognised argument %q — services are picked with +service or -service (services: %s)", d, strings.Join(SelectableServices, ", "))
		}
		name := d[1:]
		if note := refusedSelectionName(name, layout); note != "" {
			return sel, fmt.Errorf("%q %s", name, note)
		}
		next, err := applySelectionDelta(sel, name, d[0] == '+')
		if err != nil {
			return sel, err
		}
		sel = next
	}
	return sel, nil
}

// refusedSelectionName is why a ±name is refused by name rather than applied,
// or "" when it names something this checkout can actually select. The
// layout's own refusals come first: they are the more specific answer.
func refusedSelectionName(name string, layout Layout) string {
	if layout.IsMonolith() {
		if note, refused := MonolithRetiredSelectionServices[name]; refused {
			return note
		}
	}
	return RetiredSelectionServices[name]
}

// applySelectionDelta turns one accepted ±name into the selection it makes.
func applySelectionDelta(sel Selection, name string, on bool) (Selection, error) {
	switch name {
	case "gateway":
		sel.Gateway = on
	case "nlp":
		sel.NLP = on
	case "langy":
		sel.Langy = on
	case "idp":
		sel.IDP = on
	case "design-system":
		sel.DesignSystem = on
	case "mail-room":
		sel.MailRoom = on
	default:
		return sel, fmt.Errorf("unknown service %q — services: %s", name, strings.Join(SelectableServices, ", "))
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
		case DesignSystemService:
			sel.DesignSystem = local
		case MailRoomService:
			sel.MailRoom = local
		}
	}
	return sel
}

// CLIServiceName maps an internal service name to its CLI spelling — the CLI
// says langy, never langyagent (ADR-064: one name), and it says ui for the
// routed `app` hostname, which is the browser application's lane. The hostname
// keeps the name app.<slug> because the API is served under it at /api; the
// LANE is the Vite process alone, and `haven logs ui` / `haven restart ui`
// must name the same thing the supervisor labels. The two developer tools need
// no entry here: their hostnames (design-system, mail-room) are already their
// CLI spelling.
func CLIServiceName(internal string) string {
	return CLIServiceNameForLayout(internal, LayoutModular)
}

// CLIServiceNameForLayout is CLIServiceName against a known layout. Only the
// routed `app` hostname differs: a monolith checkout runs ONE process behind
// it, and that lane is called app, so calling it ui would name a lane this
// stack does not have.
func CLIServiceNameForLayout(internal string, layout Layout) string {
	switch internal {
	case "langyagent":
		return "langy"
	case "app":
		if layout.IsMonolith() {
			return MonolithAppLane
		}
		return "ui"
	default:
		return internal
	}
}

// Describe renders the selection for humans: what runs, what is off, and the
// exact delta that adds it.
func (s Selection) Describe() string { return s.DescribeForLayout(LayoutModular) }

// DescribeForLayout is Describe for a known layout: a monolith checkout runs
// one Node lane, so naming two would describe a stack that is not there.
func (s Selection) DescribeForLayout(layout Layout) string {
	on := []string{"ui", "backend"}
	if layout.IsMonolith() {
		on = []string{MonolithAppLane}
	}
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
	add(s.DesignSystem, "design-system")
	add(s.MailRoom, "mail-room")
	out := "services: " + strings.Join(on, " · ")
	if len(off) > 0 {
		out += "   off: " + strings.Join(off, " · ")
	}
	return out
}
