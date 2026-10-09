package lanediff

import (
	"fmt"
	"io"
	"sort"
	"strings"
)

// Report is everything Render writes.
type Report struct {
	Base, Head                 Ref
	BaseRegistry, HeadRegistry Registry
	Result                     Result
}

func cell(s string) string {
	if s == "" {
		return "-"
	}
	return strings.ReplaceAll(s, "|", `\|`)
}

func code(s string) string {
	if s == "" {
		return "-"
	}
	return "`" + cell(s) + "`"
}

// Render writes the report as Markdown.
func Render(w io.Writer, r Report) {
	m := markdown{w: w}
	m.summary(r)
	m.items("Lanes on base and not on head", r.Result.RemovedLanes)
	m.items("Pipelines on base and not on head", r.Result.RemovedPipelines)
	m.items("Process managers on base and not on head", r.Result.RemovedProcesses)
	m.drains(r.Result.Drains)
	m.items("Lanes the static read could not resolve on base", r.Result.UnresolvedBase)
	m.lanes("Lanes the static read could not resolve on head", r.Result.UnresolvedHead)
	m.lanes("Lanes on head and not on base", r.Result.AddedLanes)
	m.additions(r.Result)
}

type markdown struct{ w io.Writer }

func (m markdown) p(format string, args ...any) { fmt.Fprintf(m.w, format, args...) }

func (m markdown) summary(r Report) {
	res := r.Result
	m.p("## Generated: worker registry diff\n\n")
	m.p("Base `%s` at `%s`; head `%s` at `%s`. Regenerate with\n", r.Base.Name, r.Base.Commit, r.Head.Name, r.Head.Commit)
	m.p("`go run ./cmd/lanediff -root .. -rules ../tools/lane-diff/classification.json` from `cmd/`; edit the\n")
	m.p("classification file, never this section.\n\n")
	m.p("| Registry | Base | Head |\n| - | - | - |\n")
	m.p("| pipelines | %d | %d |\n", len(r.BaseRegistry.Pipelines), len(r.HeadRegistry.Pipelines))
	m.p("| lanes (`pipeline:jobType:name`) | %d | %d |\n", len(r.BaseRegistry.Lanes), len(r.HeadRegistry.Lanes))
	m.p("| process managers (outbox process names) | %d | %d |\n", len(r.BaseRegistry.ProcessManagers), len(r.HeadRegistry.ProcessManagers))
	m.p("| `lw.*` event type literals | %d | %d |\n", len(r.BaseRegistry.EventTypes), len(r.HeadRegistry.EventTypes))
	m.p("| upcast drains | %d | %d |\n\n", len(r.BaseRegistry.Drains), len(r.HeadRegistry.Drains))
	m.p("Lanes kept under the same key: %d. Base-only items by class:", res.Kept)
	counts := classCounts(res)
	classes := make([]string, 0, len(counts))
	for c := range counts {
		classes = append(classes, c)
	}
	sort.Strings(classes)
	for _, c := range classes {
		m.p(" %s %d;", c, counts[c])
	}
	m.p(" unresolved on base %d, on head %d.\n\n", len(res.UnresolvedBase), len(res.UnresolvedHead))
}

func classCounts(res Result) map[string]int {
	counts := map[string]int{}
	for _, group := range [][]Item{res.RemovedLanes, res.RemovedPipelines, res.RemovedProcesses, res.UnresolvedBase} {
		for _, item := range group {
			counts[item.Class]++
		}
	}
	return counts
}

func (m markdown) items(title string, list []Item) {
	m.p("### %s (%d)\n\n", title, len(list))
	if len(list) == 0 {
		m.p("None.\n\n")
		return
	}
	m.p("| Key on base | Declared at (base) | Seen on head | Class | Ref | Note |\n| - | - | - | - | - | - |\n")
	for _, it := range list {
		m.p("| %s | %s | %s | %s | %s | %s |\n", code(it.Key), code(it.Where), cell(it.Successor), cell(it.Class), cell(it.Ref), cell(it.Note))
	}
	m.p("\n")
}

func (m markdown) drains(drains []Drain) {
	m.p("### Upcast drains declared on head (%d)\n\n", len(drains))
	for _, d := range drains {
		m.p("- `%s` drains into `%s` (%s)\n", d.Former, d.Current, d.File)
	}
	m.p("\n")
}

func (m markdown) lanes(title string, list []Lane) {
	m.p("### %s (%d)\n\n", title, len(list))
	if len(list) == 0 {
		m.p("None.\n\n")
		return
	}
	m.p("| Key | Declared at |\n| - | - |\n")
	for _, l := range list {
		key := l.Key()
		if l.Heuristic {
			key += " (name read from a factory body)"
		}
		m.p("| %s | %s |\n", code(key), code(where(l.File, l.Line)))
	}
	m.p("\n")
}

func (m markdown) bullets(title string, list []string) {
	m.p("### %s (%d)\n\n", title, len(list))
	for _, v := range list {
		m.p("- %s\n", v)
	}
	m.p("\n")
}

func (m markdown) additions(res Result) {
	var processes []string
	for _, pm := range res.AddedProcesses {
		processes = append(processes, fmt.Sprintf("`%s:%s` (%s)", pm.Pipeline, pm.Name, where(pm.File, pm.Line)))
	}
	m.bullets("Process managers on head and not on base", processes)
	m.bullets("Pipelines on head and not on base", backticked(res.AddedPipelines))
	m.bullets("`lw.*` event type literals on base and not on head", backticked(res.RemovedEventTypes))
	m.bullets("`lw.*` event type literals on head and not on base", backticked(res.AddedEventTypes))
	var unused []string
	for _, rule := range res.UnusedRules {
		unused = append(unused, fmt.Sprintf("`%s` (%s)", rule.Match, rule.Class))
	}
	if len(unused) > 0 {
		m.bullets("Classification rules that matched nothing", unused)
	}
}

func backticked(list []string) []string {
	out := make([]string, 0, len(list))
	for _, v := range list {
		out = append(out, "`"+v+"`")
	}
	return out
}
