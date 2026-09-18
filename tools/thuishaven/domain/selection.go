package domain

import (
	"fmt"
	"strings"
)

// Selection is a worktree's sticky service choice (ADR-064): which optional
// services `haven up` runs here. app always runs and is not selectable.
// Expressed as deltas on up (`haven up +langy`, `haven up -nlp`), persisted
// per worktree, shown by status. The zero value is NOT a fresh worktree's
// default — that is DefaultSelection.
type Selection struct {
	// Workers true runs the background workers as their own standalone lane;
	// false (the default) hosts them inside the app process, saving the RAM
	// of a second Node process.
	Workers bool `json:"workers"`
	Gateway bool `json:"gateway"`
	NLP     bool `json:"nlp"`
	// Langy is off by default: it costs a container image and a hard memory
	// cap that most worktrees never exercise. The worktrees that need it say
	// `haven up +langy` once.
	Langy bool `json:"langy"`
}

// DefaultSelection is a fresh worktree's lean default: app (workers
// in-process), gateway, and nlp — no langy.
func DefaultSelection() Selection { return Selection{Gateway: true, NLP: true} }

// SelectableServices are the names ±deltas accept, in display order.
var SelectableServices = []string{"workers", "gateway", "nlp", "langy"}

// ApplySelectionDeltas folds `+svc` / `-svc` arguments into a selection.
func ApplySelectionDeltas(sel Selection, deltas []string) (Selection, error) {
	for _, d := range deltas {
		if len(d) < 2 || (d[0] != '+' && d[0] != '-') {
			return sel, fmt.Errorf("unrecognised argument %q — services are picked with +service or -service (services: %s)", d, strings.Join(SelectableServices, ", "))
		}
		on := d[0] == '+'
		switch d[1:] {
		case "workers":
			sel.Workers = on
		case "gateway":
			sel.Gateway = on
		case "nlp":
			sel.NLP = on
		case "langy":
			sel.Langy = on
		default:
			return sel, fmt.Errorf("unknown service %q — services: %s", d[1:], strings.Join(SelectableServices, ", "))
		}
	}
	return sel, nil
}

// SelectionFromStack derives what a running stack actually runs, so a plain
// `up` can tell "already matches the selection" from "needs a restart".
func SelectionFromStack(st Stack) Selection {
	sel := Selection{Workers: st.HasStandaloneWorkers}
	for _, svc := range st.Services {
		local := svc.Port != 0 && !svc.IsFallback
		switch svc.Name {
		case "gateway":
			sel.Gateway = local
		case "nlp":
			sel.NLP = local
		case "langyagent":
			sel.Langy = local
		}
	}
	return sel
}

// CLIServiceName maps an internal service name to its CLI spelling — the CLI
// says langy, never langyagent (ADR-064: one name).
func CLIServiceName(internal string) string {
	if internal == "langyagent" {
		return "langy"
	}
	return internal
}

// Describe renders the selection for humans: what runs, what is off, and the
// exact delta that adds it.
func (s Selection) Describe() string {
	on := []string{"app"}
	if s.Workers {
		on = append(on, "workers (own lane)")
	} else {
		on = append(on, "workers (in-process)")
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
	out := "services: " + strings.Join(on, " · ")
	if len(off) > 0 {
		out += "   off: " + strings.Join(off, " · ")
	}
	return out
}
