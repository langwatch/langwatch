package diffsuite

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/visualdiff"
)

// The PR body section publish owns. Inside it, publish rewrites the lines before the
// first "### " heading and the first table under each machine heading; every other line
// is hand-kept and left as it is.
const (
	sectionStart = "<!-- parity-status:start -->"
	sectionEnd   = "<!-- parity-status:end -->"
)

// Publish is `diffsuite publish`: it renders one suite run into the pull request's
// parity-status section, and keeps visualdiff's screens comment in step with it.
func Publish(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("diffsuite publish", flag.ContinueOnError)
	flags.SetOutput(stderr)
	out := flags.String("out", "", "the suite run's -out directory")
	pr := flags.String("pr", "", "the pull request whose body carries the parity-status section")
	dryRun := flags.Bool("dry-run", false, "print the new body; patch and post nothing")
	if flags.Parse(args) != nil || *out == "" || *pr == "" {
		fmt.Fprintln(stderr, "usage: diffsuite publish -out <dir> -pr <N> [-dry-run]")
		return 2
	}
	if err := publish(context.Background(), publishRequest{out: *out, pr: *pr, dryRun: *dryRun, stdout: stdout, stderr: stderr}); err != nil {
		fmt.Fprintln(stderr, "diffsuite publish:", err)
		return 2
	}
	return 0
}

type publishRequest struct {
	out, pr        string
	dryRun         bool
	stdout, stderr io.Writer
}

func publish(ctx context.Context, request publishRequest) error {
	root := repoRoot()
	out, err := filepath.Abs(request.out)
	if err != nil {
		return err
	}
	found, err := readResults(out, root)
	if err != nil {
		return err
	}
	statePath := filepath.Join(filepath.Dir(out), "published.json")
	state := readPublished(statePath)
	before := state.Latest
	if state.Out == out {
		before = state.Before
	}
	rows := found.runRows()
	if !request.dryRun {
		if screens := publishScreens(ctx, root, request.pr, rows, request.stderr); screens != "" {
			rows[1].latest += " · [screens](" + screens + ")"
		}
	}
	body, err := ghOutput(ctx, root, "api", "repos/{owner}/{repo}/pulls/"+request.pr, "--jq", ".body")
	if err != nil {
		return err
	}
	updated, err := splice(strings.TrimSuffix(body, "\n"), found.preamble(rows, time.Local), found.tables(rows, before))
	if err != nil {
		return err
	}
	if request.dryRun {
		fmt.Fprintln(request.stdout, updated)
		return nil
	}
	url, err := ghOutput(ctx, root, "api", "repos/{owner}/{repo}/pulls/"+request.pr, "-X", "PATCH", "-f", "body="+updated, "--jq", ".html_url")
	if err != nil {
		return err
	}
	fmt.Fprintf(request.stderr, "diffsuite publish: %s\n", strings.TrimSpace(url))
	latest := map[string]string{}
	for _, row := range rows {
		latest[row.key] = row.latest
	}
	return writePublished(statePath, published{Out: out, Latest: latest, Before: before})
}

// published is what the last publish showed per check, so the next can show it as the run before.
// It lives beside the suite directories (.claude/tmp/runs/published.json for the usual layout).
type published struct {
	Out    string            `json:"out"`
	Latest map[string]string `json:"latest"`
	Before map[string]string `json:"before"`
}

func readPublished(path string) published {
	var state published
	if body, err := os.ReadFile(path); err == nil { // #nosec G304 -- publish's own state file.
		_ = json.Unmarshal(body, &state)
	}
	return state
}

func writePublished(path string, state published) error {
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o600)
}

func ghOutput(ctx context.Context, root string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "gh", args...) // #nosec G204 -- fixed gh subcommands.
	command.Dir = root
	out, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("gh %s: %w", args[0], err)
	}
	return string(out), nil
}

// publishScreens updates visualdiff's one screens comment from check's report when the
// UI run is usable, and withdraws it when not; it answers the comment's address, or "".
func publishScreens(ctx context.Context, root, pr string, rows []runRow, stderr io.Writer) string {
	if rows[1].usable == "yes" {
		command := exec.CommandContext(ctx, filepath.Join(root, ".bin", "visualdiff", "visualdiff"), "publish", // #nosec G204 -- the suite's own binary.
			"-root", root, "-run-dir", filepath.Join(root, ".visualdiff", "check"), "-pr", pr)
		command.Dir, command.Stderr = root, stderr
		out, err := command.Output()
		if err != nil {
			fmt.Fprintln(stderr, "diffsuite publish: screens:", err)
		}
		return strings.TrimSpace(string(out))
	}
	ids, err := ghOutput(ctx, root, "api", "--paginate", "repos/{owner}/{repo}/issues/"+pr+"/comments",
		"--jq", `.[] | select(.body | contains("`+visualdiff.PublishMarker+`")) | .id`)
	if err != nil {
		fmt.Fprintln(stderr, "diffsuite publish: screens:", err)
	}
	for _, id := range strings.Fields(ids) {
		if _, err := ghOutput(ctx, root, "api", "-X", "DELETE", "repos/{owner}/{repo}/issues/comments/"+id); err != nil {
			fmt.Fprintln(stderr, "diffsuite publish: withdraw the screens comment:", err)
		}
	}
	return ""
}

// runRow is one line of "Test runs": a check, this run, the run before and whether it can be used.
type runRow struct {
	key, check, latest, usable string
}

// runRows are the four checks in a fixed order: API, UI, fuzz API, fuzz UI.
func (found results) runRows() []runRow {
	api, visual, fuzzAPI, fuzzUI := found.api, found.visual, found.fuzzAPI, found.fuzzUI
	rows := []runRow{
		{key: "API", check: "API: apidiff", latest: found.notRun("api"), usable: "no"},
		{key: "UI", check: "UI: visualdiff", latest: found.notRun("visual"), usable: "no"},
		{key: "Fuzz API", check: "Fuzz API", latest: found.notRun("fuzzapi"), usable: "no"},
		{key: "Fuzz UI", check: "Fuzz UI", latest: found.notRun("fuzzui"), usable: "no"},
	}
	if api.ran {
		measured := api.pass + api.fail + api.errors
		rows[0].check = fmt.Sprintf("API: apidiff, %s scenarios", thousands(measured+api.deferred))
		rows[0].latest = fmt.Sprintf("%s pass · %s fail · %s tool errors", thousands(api.pass), thousands(api.fail), thousands(api.errors))
		if api.deferred > 0 {
			rows[0].latest += fmt.Sprintf(" · %s deferred to the self-hosted pass", thousands(api.deferred))
		}
		rows[0].usable = found.verdictFor("api", api.errors*10 >= measured, "too many tool errors")
	}
	if visual.ran {
		rows[1].latest = fmt.Sprintf("%d of %d flows pass", visual.flowsPass, visual.flowsTotal)
		if visual.routesTotal > 0 {
			rows[1].latest += fmt.Sprintf(" · %d of %d routes without a finding", visual.routesClean, visual.routesTotal)
		}
		rows[1].usable = found.verdictFor("visual", visual.flowsTotal == 0, "no flow ran")
	}
	if fuzzAPI.ran {
		rows[2].check = fmt.Sprintf("Fuzz API: %s operations, %s requests", thousands(fuzzAPI.operations), thousands(fuzzAPI.requests))
		rows[2].latest = thousands(fuzzAPI.findings) + " findings"
		if fuzzAPI.proxy502 > 0 {
			rows[2].latest += fmt.Sprintf(", %s of them 502s from the proxy", thousands(fuzzAPI.proxy502))
		}
		rows[2].usable = found.verdictFor("fuzzapi", fuzzAPI.proxy502*2 > fuzzAPI.findings, "most findings are 502s from the proxy")
	}
	if fuzzUI.ran {
		rows[3].latest = fmt.Sprintf("%d of %d routes visited · %s findings", fuzzUI.visited, fuzzUI.routes, thousands(fuzzUI.findings))
		if fuzzUI.hangs > 0 {
			rows[3].latest += fmt.Sprintf(", %s never finished loading", thousands(fuzzUI.hangs))
		}
		broken, why := fuzzUI.visited == 0, "no page finished loading"
		if !broken && fuzzUI.hangs*2 > fuzzUI.findings {
			broken, why = true, "most pages never finished loading"
		}
		rows[3].usable = found.verdictFor("fuzzui", broken, why)
	}
	return rows
}

// notRun says why a tool left no results: missing from the suite, stopped, or its exit.
func (found results) notRun(name string) string {
	tool, ok := found.tools[name]
	switch {
	case !ok:
		return "not run"
	case tool.Stop != nil && tool.Stop.Reason != "":
		return "not run: stopped, " + tool.Stop.Reason
	default:
		return fmt.Sprintf("not run: exit %d", tool.Exit)
	}
}

// verdictFor is "yes", or why the run can't be used: the tool stopped (exit 3) or was
// killed, or its own results say so. apidiff's exit 2 (any ERROR) is judged by its results.
func (found results) verdictFor(name string, broken bool, why string) string {
	if tool, ok := found.tools[name]; ok && (tool.Exit == diffkit.ExitStopped || tool.Exit > 128) {
		if tool.Stop != nil && tool.Stop.Reason != "" {
			return "no, rerun: stopped, " + tool.Stop.Reason
		}
		return fmt.Sprintf("no, rerun: exit %d", tool.Exit)
	}
	if broken {
		return "no, rerun: " + why
	}
	return "yes"
}

// preamble is the header line and the one-line verdict.
func (found results) preamble(rows []runRow, zone *time.Location) []string {
	header := []string{}
	if !found.at.IsZero() {
		header = append(header, "Latest run: "+found.at.In(zone).Format("2006-01-02 15:04 MST"))
	}
	if found.commit != "" {
		header = append(header, "commit `"+found.commit+"`")
	}
	if found.branch != "" {
		header = append(header, "stack `"+found.branch+"`")
	}
	if found.main != "" {
		header = append(header, "compared with main's stack `"+found.main+"`")
	} else {
		header = append(header, "compared with main's baselines")
	}
	var unusable []string
	for _, row := range rows {
		if row.usable != "yes" {
			unusable = append(unusable, row.key)
		}
	}
	failing := found.api.fail + found.api.errors + found.visual.flowsTotal - found.visual.flowsPass
	verdict := "**Verdict: not ready.**"
	if len(unusable) == 0 && failing == 0 {
		verdict = "**Verdict: ready.**"
	}
	if found.api.ran {
		verdict += fmt.Sprintf(" API: %s of %s scenarios pass.", thousands(found.api.pass), thousands(found.api.pass+found.api.fail+found.api.errors))
	}
	if found.visual.ran {
		verdict += fmt.Sprintf(" UI: %d of %d flows pass.", found.visual.flowsPass, found.visual.flowsTotal)
	}
	if len(unusable) > 0 {
		verdict += " Not usable from this run: " + strings.Join(unusable, ", ") + " (see \"Test runs\")."
	}
	return []string{"## Parity status", "", "_" + strings.Join(header, " · ") + "_", "", verdict, ""}
}

// tableSpec is one machine table: the heading it sits under, the column its rows are
// matched on, the hand cells an old row keeps, and the render given those.
type tableSpec struct {
	heading string
	key     int
	keep    func(cells []string) []string
	render  func(hand map[string][]string) []string
}

func (found results) tables(rows []runRow, before map[string]string) []tableSpec {
	return []tableSpec{
		{heading: "Coverage by area", key: 1, keep: func(cells []string) []string { return cellsAt(cells, 3, 4) }, render: found.coverageTable},
		{heading: "Open defects", key: 0, keep: func(cells []string) []string { return cellsAt(cells, 1, len(cells)-1) }, render: found.defectsTable},
		{heading: "Test runs", key: 0, keep: func([]string) []string { return nil }, render: func(map[string][]string) []string {
			lines := []string{"| check | latest run | run before | usable? |", "|---|---|---|---|"}
			for _, row := range rows {
				previous := before[row.key]
				if previous == "" {
					previous = "not recorded"
				}
				lines = append(lines, "| "+strings.Join([]string{row.check, row.latest, previous, row.usable}, " | ")+" |")
			}
			return lines
		}},
	}
}

func cellsAt(cells []string, indexes ...int) []string {
	picked := make([]string, 0, len(indexes))
	for _, index := range indexes {
		if index >= 0 && index < len(cells) {
			picked = append(picked, cells[index])
		} else {
			picked = append(picked, "")
		}
	}
	return picked
}

// coverageTable is one row per area, red first: green when every API scenario passes and
// the UI is proven, orange at 90% or more or with the UI unproven, red below or untested.
func (found results) coverageTable(hand map[string][]string) []string {
	type row struct {
		rank int
		line string
		area string
	}
	var rows []row
	for _, area := range found.areaNames() {
		kept := cellsAt(hand[area], 0, 1)
		ui, rest := kept[0], kept[1]
		if ui == "" {
			ui = "not tested yet"
		}
		proven := ui != "not tested yet"
		if flows := found.visual.areas[area]; flows != nil && flows.total > 0 {
			ui, proven = fmt.Sprintf("%d of %d flows pass", flows.pass, flows.total), flows.pass == flows.total
		}
		api, rank := "not tested yet", 0
		if scenarios := found.api.areas[area]; scenarios != nil && scenarios.total > 0 {
			api = fmt.Sprintf("%d/%d", scenarios.pass, scenarios.total)
			if failing := scenarios.total - scenarios.pass; failing > 0 {
				api += fmt.Sprintf(" · %d failing", failing)
			}
			switch {
			case scenarios.pass == scenarios.total && proven:
				rank = 2
			case scenarios.pass*10 >= scenarios.total*9:
				rank = 1
			}
		}
		colour := []string{"🔴", "🟠", "🟢"}[rank]
		rows = append(rows, row{rank: rank, area: area, line: "| " + strings.Join([]string{colour, area, api, ui, rest}, " | ") + " |"})
	}
	slices.SortFunc(rows, func(a, b row) int {
		if a.rank != b.rank {
			return a.rank - b.rank
		}
		return strings.Compare(a.area, b.area)
	})
	lines := []string{"| | area | API vs main (latest run) | UI proven against main | not tested yet or failing |", "|---|---|---|---|---|"}
	for _, row := range rows {
		lines = append(lines, row.line)
	}
	return lines
}

// areaNames are every mapped area plus any other the run's results name, sorted.
func (found results) areaNames() []string {
	names := map[string]bool{}
	for area := range areaFamilies {
		names[area] = true
	}
	for area := range found.api.areas {
		names[area] = true
	}
	for area := range found.visual.areas {
		names[area] = true
	}
	sorted := make([]string, 0, len(names))
	for area := range names {
		sorted = append(sorted, area)
	}
	slices.Sort(sorted)
	return sorted
}

// defectsTable is the failures grouped by area, most first, with example ids; what's
// wrong and the status are hand-kept per area.
func (found results) defectsTable(hand map[string][]string) []string {
	type row struct {
		count int
		area  string
		line  string
	}
	var rows []row
	for _, area := range found.areaNames() {
		var parts, ids []string
		count := 0
		if scenarios := found.api.areas[area]; scenarios != nil && len(scenarios.failing) > 0 {
			parts = append(parts, fmt.Sprintf("%d scenarios", len(scenarios.failing)))
			ids, count = append(ids, scenarios.failing...), count+len(scenarios.failing)
		}
		if flows := found.visual.areas[area]; flows != nil && len(flows.failing) > 0 {
			parts = append(parts, fmt.Sprintf("%d UI flows", len(flows.failing)))
			ids, count = append(ids, flows.failing...), count+len(flows.failing)
		}
		if count == 0 {
			continue
		}
		kept := cellsAt(hand[area], 0, 1)
		status := kept[1]
		if status == "" {
			status = "open"
		}
		rows = append(rows, row{count: count, area: area, line: "| " + strings.Join([]string{area, kept[0], strings.Join(parts, ", "), examples(ids), status}, " | ") + " |"})
	}
	slices.SortFunc(rows, func(a, b row) int {
		if a.count != b.count {
			return b.count - a.count
		}
		return strings.Compare(a.area, b.area)
	})
	lines := []string{"| area | what's wrong | failing | examples | status |", "|---|---|---|---|---|"}
	for _, row := range rows {
		lines = append(lines, row.line)
	}
	if len(rows) == 0 {
		lines = append(lines, "| none | nothing failed in the latest run | 0 | | |")
	}
	return lines
}

// examples names the first three ids and how many more.
func examples(ids []string) string {
	shown := make([]string, 0, 3)
	for _, id := range ids[:min(3, len(ids))] {
		shown = append(shown, "`"+id+"`")
	}
	text := strings.Join(shown, " · ")
	if len(ids) > 3 {
		text += fmt.Sprintf(" and %d more", len(ids)-3)
	}
	return text
}

func thousands(value int) string {
	text := strconv.Itoa(value)
	for at := len(text) - 3; at > 0; at -= 3 {
		text = text[:at] + "," + text[at:]
	}
	return text
}

// chunk is the section's lines under one "### " heading; the first chunk, with no
// heading, is the preamble.
type chunk struct {
	heading string
	lines   []string
}

// splice rewrites the parity-status section of body: the preamble, and each machine table
// under its heading (a missing heading is added after the one before it). Everything else
// in the section, and everything outside it, is kept.
func splice(body string, preamble []string, tables []tableSpec) (string, error) {
	start, end := strings.Index(body, sectionStart), strings.Index(body, sectionEnd)
	if start < 0 || end < start {
		return "", fmt.Errorf("the body has no %s ... %s section", sectionStart, sectionEnd)
	}
	inner := strings.Trim(body[start+len(sectionStart):end], "\n")
	chunks := []chunk{{}}
	for _, line := range strings.Split(inner, "\n") {
		if heading, ok := strings.CutPrefix(line, "### "); ok {
			chunks = append(chunks, chunk{heading: strings.TrimSpace(heading)})
		}
		chunks[len(chunks)-1].lines = append(chunks[len(chunks)-1].lines, line)
	}
	chunks[0].lines = preamble
	for index, spec := range tables {
		at := findChunk(chunks, spec.heading)
		if at < 0 {
			at = 1
			if index > 0 {
				if previous := findChunk(chunks, tables[index-1].heading); previous >= 0 {
					at = previous + 1
				}
			}
			chunks = slices.Insert(chunks, at, chunk{heading: spec.heading, lines: []string{"### " + spec.heading, ""}})
		}
		chunks[at].lines = replaceTable(chunks[at].lines, spec)
	}
	var lines []string
	for _, part := range chunks {
		lines = append(lines, part.lines...)
	}
	return body[:start] + sectionStart + "\n" + strings.Trim(strings.Join(lines, "\n"), "\n") + "\n" + body[end:], nil
}

func findChunk(chunks []chunk, heading string) int {
	return slices.IndexFunc(chunks, func(candidate chunk) bool { return candidate.heading == heading })
}

// replaceTable swaps the first table in lines for the spec's, rendered with the hand
// cells of the rows it replaces; with no table, the new one goes under the heading.
func replaceTable(lines []string, spec tableSpec) []string {
	first, last := -1, -1
	for index, line := range lines {
		if strings.HasPrefix(line, "|") {
			if first < 0 {
				first = index
			}
			last = index
		} else if first >= 0 {
			break
		}
	}
	hand := map[string][]string{}
	for index := first + 2; first >= 0 && index <= last; index++ {
		cells := splitCells(lines[index])
		if spec.key < len(cells) {
			hand[cells[spec.key]] = spec.keep(cells)
		}
	}
	table := spec.render(hand)
	if first < 0 {
		at := min(2, len(lines))
		return slices.Concat(lines[:at], table, []string{""}, lines[at:])
	}
	return slices.Concat(lines[:first], table, lines[last+1:])
}

func splitCells(line string) []string {
	cells := strings.Split(strings.Trim(strings.TrimSpace(line), "|"), "|")
	for index := range cells {
		cells[index] = strings.TrimSpace(cells[index])
	}
	return cells
}
