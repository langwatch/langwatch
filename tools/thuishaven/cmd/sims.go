package cmd

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// simulators is every sim haven can run, in the order `haven sims` lists them;
// skill is the .claude/skills directory that teaches it.
var simulators = []struct{ name, skill string }{
	{"mail", "mailsim"}, {"idp", "idpsim"}, {"storage", "storagesim"}, {"llm", "llmsim"},
	{"voice", "voicesim"}, {"analytics", "analyticssim"}, {"outbound", "outboundsim"}, {"payment", "paymentsim"}, {"telemetry", "telemetrysim"}, {"lambda", "lambdasim"},
}

// simSpecs is the command table, read at init: the sims command sits in the
// table itself, so reading it from the initializer would be a cycle.
var simSpecs map[string]commandSpec

func init() { simSpecs = tableByName }

// simRow is one simulator as `haven sims --json` reports it.
type simRow struct {
	Name    string   `json:"name"`
	Running bool     `json:"running"`
	Console string   `json:"console,omitempty"`
	Start   string   `json:"start,omitempty"`
	Verbs   []string `json:"verbs"`
	Skill   string   `json:"skill"`
}

// runSims is `haven sims`: which simulators exist, which run here, and how to drive each.
func runSims(_ context.Context, d deps, inv invocation) error {
	slug, err := tabSlug(d, inv)
	if err != nil {
		return err
	}
	rows := simRows(d.orch.SessionSnapshot(slug).Services)
	if inv.has("--json") || d.isAgent {
		return printMailJSON(rows)
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "SIM\tRUNNING\tCONSOLE / START\tVERBS")
	for _, r := range rows {
		where := r.Console
		if !r.Running {
			where = r.Start
		}
		fmt.Fprintf(w, "%s\t%t\t%s\thaven %s %s\n", r.Name, r.Running, where, r.Name, strings.Join(r.Verbs, "|"))
	}
	return w.Flush()
}

// simRows joins the simulator list with the services this stack runs.
func simRows(services []app.SessionServiceStatus) []simRow {
	rows := make([]simRow, 0, len(simulators))
	for _, sim := range simulators {
		row := simRow{Name: sim.name, Verbs: simVerbs(sim.name), Skill: ".claude/skills/" + sim.skill + "/SKILL.md"}
		for _, s := range services {
			if s.Name == sim.name && s.Up {
				row.Running, row.Console = true, s.URL
			}
		}
		if !row.Running {
			row.Start = "haven up +" + sim.name
		}
		rows = append(rows, row)
	}
	return rows
}

// simVerbs reads a sim's verbs from its command spec: idp's from its verb map,
// the rest from the leading "<a|b|c>" of the spec's args.
func simVerbs(name string) []string {
	if name == "idp" {
		verbs := make([]string, 0, len(idpVerbs))
		for words := range idpVerbs {
			verbs = append(verbs, words)
		}
		sort.Strings(verbs)
		return verbs
	}
	args := simSpecs[name].args
	open, end := strings.Index(args, "<"), strings.Index(args, ">")
	if open < 0 || end < open {
		return nil
	}
	return strings.Split(args[open+1:end], "|")
}
