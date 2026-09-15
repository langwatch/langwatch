package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Every tab of the up viewer is also a command. The viewer is a terminal
// application, and an agent driving haven cannot read one: without this, half
// of what haven knows about a running stack would be reachable only by a person
// with a keyboard. The command and the tab share the tab's own Rows, so the two
// can never drift into disagreeing about what the stack is doing.

// tabCommands are the viewer tabs that get a command of their own. Two of the
// eight already had one and keep it, because ADR-064 allows exactly one name
// per command: the session tab's rows are `haven status`, and the logs tab's
// are `haven logs`.
var tabCommands = []string{"errors", "traces", "metrics", "profiles", "stores", "jobs"}

// tabSpecs builds the command table's entries for the viewer tabs.
func tabSpecs() []commandSpec {
	out := make([]commandSpec, 0, len(tabCommands))
	for _, name := range tabCommands {
		out = append(out, commandSpec{
			name:    name,
			summary: tabSummaries[name],
			flags: []flagSpec{
				{long: "--json", summary: "machine-readable"},
				{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
			},
			run: runTabCmd(name),
		})
	}
	return out
}

// tabSummaries is each tab command's one line in help.
var tabSummaries = map[string]string{
	"errors":   "the last distinct failures across every lane, grouped and counted",
	"traces":   "this stack's recent root spans, newest first",
	"metrics":  "request rate, latency, queue depth and footprint over the last ten minutes",
	"profiles": "the functions burning the most CPU and heap, per service",
	"stores":   "each managed database server against the limit haven gave it",
	"jobs":     "the one-shot lanes this up ran: install, codegen, migrations, seed, images",
}

// runTabCmd answers one tab's rows from a terminal. It builds exactly the tab
// the viewer builds, polls it once, and prints - so a difference between the
// command and the screen would have to be a difference in the datasource, not
// in two renderings of it.
func runTabCmd(name string) func(context.Context, deps, invocation) error {
	return func(_ context.Context, d deps, inv invocation) error {
		slug, err := tabSlug(d, inv)
		if err != nil {
			return err
		}
		m := newViewerModel(slug, stackLogPath(slug), filepath.Join(havenHome(), "logs", slug))
		m.enableDashboard(d.sessionActions(slug), false)
		m.ingest()
		tab, ok := m.tabs[name]
		if !ok {
			return fmt.Errorf("haven %s: no such tab", name)
		}
		tab.Poll()
		if inv.has("--json") || d.isAgent {
			return printTabJSON(tab)
		}
		printTabBody(tab)
		return nil
	}
}

// tabSlug resolves which stack the command reads, defaulting to this worktree's.
func tabSlug(d deps, inv invocation) (string, error) {
	slug := inv.value("--stack")
	if slug == "" {
		return d.orch.ResolveSlug(d.params)
	}
	// The value becomes a path segment below, so it is gated the way every
	// other slug entry point is.
	if !domain.ValidSlug(slug) {
		return "", fmt.Errorf("--stack %q is not a valid stack slug", slug)
	}
	return slug, nil
}

// printTabJSON writes the tab's rows, the same ones the screen renders.
func printTabJSON(tab viewer.Tab) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(tab.Rows())
}

// tabCommandRows is how tall a tab renders for a terminal that is not a viewer:
// tall enough that nothing is elided, since there is no scrolling here.
const tabCommandRows = 500

// printTabBody writes the tab's own screen, minus the frame around it.
func printTabBody(tab viewer.Tab) {
	for _, row := range tab.Body(viewer.Frame{Width: 0, Height: tabCommandRows}) {
		fmt.Println(row.Text)
	}
}
