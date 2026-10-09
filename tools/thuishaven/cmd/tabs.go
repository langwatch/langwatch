package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
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
		if name == "traces" {
			out = append(out, tracesSpec())
			continue
		}
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
		m := newViewerModel(slug, d.orch.LogPath(slug), d.orch.LogDir(slug))
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

// tracesSpec is the traces command: the tab's rows as before, one trace's span
// tree when given an id, and a filtered search when given any filter.
func tracesSpec() commandSpec {
	return commandSpec{
		name:    "traces",
		summary: tabSummaries["traces"],
		args:    "[trace-id]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--service", takesValue: true, value: "<name>", summary: "only traces through this service"},
			{long: "--name", takesValue: true, value: "<text>", summary: "only traces with a span whose name contains this"},
			{long: "--min-duration", takesValue: true, value: "<dur>", summary: "only traces at least this long, e.g. 500ms"},
			{long: "--errors", summary: "only traces with an error span"},
			{long: "--since", takesValue: true, value: "<dur>", summary: "look back this far, e.g. 1h (default 10m)"},
			{long: "--json", summary: "machine-readable"},
			{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
		},
		run: runTraces,
	}
}

var traceIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{1,32}$`)

// traceFilterFrom reads the filter flags, refusing a value it cannot use.
func traceFilterFrom(inv invocation) (sources.TraceFilter, error) {
	f := sources.TraceFilter{
		Service: inv.value("--service"), Name: inv.value("--name"), ErrorsOnly: inv.has("--errors"),
	}
	var err error
	if f.MinDuration, err = parseDurationFlag(inv, "--min-duration"); err != nil {
		return f, err
	}
	f.Since, err = parseDurationFlag(inv, "--since")
	return f, err
}

// parseDurationFlag reads an optional duration flag; absent is zero.
func parseDurationFlag(inv invocation, flag string) (time.Duration, error) {
	v := inv.value(flag)
	if v == "" {
		return 0, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("%s wants a duration like 500ms or 1h, got %q", flag, v)
	}
	return d, nil
}

// runTraces answers `haven traces [trace-id] [filters]` from this stack's own
// Tempo, filtered to its worktree.
func runTraces(ctx context.Context, d deps, inv invocation) error {
	filter, err := traceFilterFrom(inv)
	if err != nil {
		return err
	}
	if len(inv.args) == 0 && !filter.Active() {
		return runTabCmd("traces")(ctx, d, inv)
	}
	slug, err := tabSlug(d, inv)
	if err != nil {
		return err
	}
	tempo := sources.NewTempo(observabilityEndpoints().GrafanaPort, slug)
	out := readOutput{w: os.Stdout, asJSON: inv.has("--json") || d.isAgent}
	if len(inv.args) == 1 {
		return showTrace(tempo, inv.args[0], out)
	}
	rows, err := tempo.Find(filter)
	if err != nil {
		return traceReadError(err)
	}
	out.link = tempo.FilterURL(filter)
	return printTraceList(out, rows)
}

// readOutput is where one read prints: the writer, its format and the
// Grafana link that ends it.
type readOutput struct {
	w      io.Writer
	link   string
	asJSON bool
}

// showTrace prints one trace's span tree.
func showTrace(tempo *sources.Tempo, id string, out readOutput) error {
	if !traceIDPattern.MatchString(id) {
		return fmt.Errorf("%q is not a trace id (hex, up to 32 characters)", id)
	}
	spans, err := tempo.Tree(id)
	if err != nil {
		return traceReadError(err)
	}
	out.link = tempo.GrafanaURL(id)
	return printTrace(out, spans)
}

// traceReadError names the command that fixes a stopped observability stack.
func traceReadError(err error) error {
	if errors.Is(err, sources.ErrStackDown) {
		return fmt.Errorf("%w: start it with `%s`", err, sources.StartObservabilityCommand)
	}
	return err
}

func printTrace(out readOutput, spans []sources.Span) error {
	w := out.w
	if out.asJSON {
		return encodeJSON(w, map[string]any{"spans": spans, "grafana": out.link})
	}
	if len(spans) == 0 {
		fmt.Fprintln(w, "(no spans for that trace in this stack)")
	}
	for _, s := range spans {
		fmt.Fprintf(w, "%s%s  %s  %s\n", strings.Repeat("  ", s.Depth), s.Name, s.Service, s.Duration)
	}
	fmt.Fprintln(w, "grafana:", out.link)
	return nil
}

func printTraceList(out readOutput, rows []sources.RootSpan) error {
	w := out.w
	if out.asJSON {
		return encodeJSON(w, map[string]any{"traces": rows, "grafana": out.link})
	}
	if len(rows) == 0 {
		fmt.Fprintln(w, "(no matching traces)")
	}
	for _, r := range rows {
		status := "ok"
		if r.Error {
			status = "error"
		}
		fmt.Fprintf(w, "%s  %s  %s  %s  %s  %s\n",
			r.At.Format(time.RFC3339), r.TraceID, r.Service, r.Name, r.Duration, status)
	}
	fmt.Fprintln(w, "grafana:", out.link)
	return nil
}

func encodeJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
