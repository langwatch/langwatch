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
	before := readPublished(statePath).before(out)
	rows := found.runRows()
	if !request.dryRun {
		rows[1].latest += screensLink(publishScreens(ctx, screensRequest{root: root, pr: request.pr, usable: rows[1].usable == "yes", stderr: request.stderr}))
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
	return writePublished(statePath, published{Out: out, Latest: latestOf(rows), Before: before})
}

// screensLink is the UI row's link to the screens comment, or "" without one.
func screensLink(screens string) string {
	if screens == "" {
		return ""
	}
	return " · [screens](" + screens + ")"
}

func latestOf(rows []runRow) map[string]string {
	latest := map[string]string{}
	for _, row := range rows {
		latest[row.key] = row.latest
	}
	return latest
}

// published is what the last publish showed per check, so the next can show it as the run before.
// It lives beside the suite directories (.claude/tmp/runs/published.json for the usual layout).
type published struct {
	Out    string            `json:"out"`
	Latest map[string]string `json:"latest"`
	Before map[string]string `json:"before"`
}

// before is what to show as the run before out: what the last publish showed,
// or, when that publish was of out itself, what it showed as the run before.
func (state published) before(out string) map[string]string {
	if state.Out == out {
		return state.Before
	}
	return state.Latest
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

// screensRequest is what publishScreens needs: the checkout, the PR, whether
// the UI run is usable, and where errors go.
type screensRequest struct {
	root, pr string
	usable   bool
	stderr   io.Writer
}

// publishScreens updates visualdiff's one screens comment from check's report when the
// UI run is usable, and withdraws it when not; it answers the comment's address, or "".
func publishScreens(ctx context.Context, request screensRequest) string {
	root, stderr := request.root, request.stderr
	if request.usable {
		command := exec.CommandContext(ctx, filepath.Join(root, ".bin", "visualdiff", "visualdiff"), "publish", // #nosec G204 -- the suite's own binary.
			"-root", root, "-run-dir", filepath.Join(root, ".visualdiff", "check"), "-pr", request.pr)
		command.Dir, command.Stderr = root, stderr
		out, err := command.Output()
		if err != nil {
			fmt.Fprintln(stderr, "diffsuite publish: screens:", err)
		}
		return strings.TrimSpace(string(out))
	}
	withdrawScreens(ctx, request)
	return ""
}

// withdrawScreens deletes every screens comment on the PR.
func withdrawScreens(ctx context.Context, request screensRequest) {
	root, stderr := request.root, request.stderr
	ids, err := ghOutput(ctx, root, "api", "--paginate", "repos/{owner}/{repo}/issues/"+request.pr+"/comments",
		"--jq", `.[] | select(.body | contains("`+visualdiff.PublishMarker+`")) | .id`)
	if err != nil {
		fmt.Fprintln(stderr, "diffsuite publish: screens:", err)
	}
	for _, id := range strings.Fields(ids) {
		if _, err := ghOutput(ctx, root, "api", "-X", "DELETE", "repos/{owner}/{repo}/issues/comments/"+id); err != nil {
			fmt.Fprintln(stderr, "diffsuite publish: withdraw the screens comment:", err)
		}
	}
}

// runRow is one line of "Test runs": a check, this run, the run before and whether it can be used.
type runRow struct {
	key, check, latest, usable string
}

// runRows are the four checks in a fixed order: API, UI, fuzz API, fuzz UI.
func (found results) runRows() []runRow {
	rows := []runRow{
		{key: "API", check: "API: apidiff", latest: found.notRun("api"), usable: "no"},
		{key: "UI", check: "UI: visualdiff", latest: found.notRun("visual"), usable: "no"},
		{key: "Fuzz API", check: "Fuzz API", latest: found.notRun("fuzzapi"), usable: "no"},
		{key: "Fuzz UI", check: "Fuzz UI", latest: found.notRun("fuzzui"), usable: "no"},
	}
	if found.api.ran {
		found.apiRow(&rows[0])
	}
	if found.visual.ran {
		found.visualRow(&rows[1])
	}
	if found.fuzzAPI.ran {
		found.fuzzAPIRow(&rows[2])
	}
	if found.fuzzUI.ran {
		found.fuzzUIRow(&rows[3])
	}
	return rows
}

func (found results) apiRow(row *runRow) {
	api := found.api
	measured := api.pass + api.fail + api.errors
	row.check = fmt.Sprintf("API: apidiff, %s scenarios", thousands(measured+api.deferred))
	row.latest = fmt.Sprintf("%s pass · %s fail · %s tool errors", thousands(api.pass), thousands(api.fail), thousands(api.errors))
	if api.deferred > 0 {
		row.latest += fmt.Sprintf(" · %s deferred to the self-hosted pass", thousands(api.deferred))
	}
	row.usable = found.verdictFor("api", api.errors*10 >= measured, "too many tool errors")
}

func (found results) visualRow(row *runRow) {
	visual := found.visual
	row.latest = fmt.Sprintf("%d of %d flows pass", visual.flowsPass, visual.flowsTotal)
	if visual.routesTotal > 0 {
		row.latest += fmt.Sprintf(" · %d of %d routes without a finding", visual.routesClean, visual.routesTotal)
	}
	row.usable = found.verdictFor("visual", visual.flowsTotal == 0, "no flow ran")
}

func (found results) fuzzAPIRow(row *runRow) {
	fuzzAPI := found.fuzzAPI
	row.check = fmt.Sprintf("Fuzz API: %s operations, %s requests", thousands(fuzzAPI.operations), thousands(fuzzAPI.requests))
	row.latest = thousands(fuzzAPI.findings) + " findings"
	if fuzzAPI.proxy502 > 0 {
		row.latest += fmt.Sprintf(", %s of them 502s from the proxy", thousands(fuzzAPI.proxy502))
	}
	row.usable = found.verdictFor("fuzzapi", fuzzAPI.proxy502*2 > fuzzAPI.findings, "most findings are 502s from the proxy")
}

func (found results) fuzzUIRow(row *runRow) {
	fuzzUI := found.fuzzUI
	row.latest = fmt.Sprintf("%d of %d routes visited · %s findings", fuzzUI.visited, fuzzUI.routes, thousands(fuzzUI.findings))
	if fuzzUI.hangs > 0 {
		row.latest += fmt.Sprintf(", %s never finished loading", thousands(fuzzUI.hangs))
	}
	broken, why := fuzzUI.visited == 0, "no page finished loading"
	if !broken && fuzzUI.hangs*2 > fuzzUI.findings {
		broken, why = true, "most pages never finished loading"
	}
	row.usable = found.verdictFor("fuzzui", broken, why)
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
	return []string{"## Parity status", "", "_" + strings.Join(found.header(zone), " · ") + "_", "", found.verdictLine(rows), ""}
}

func (found results) header(zone *time.Location) []string {
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
		return append(header, "compared with main's stack `"+found.main+"`")
	}
	return append(header, "compared with main's baselines")
}

func (found results) verdictLine(rows []runRow) string {
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
	return verdict
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
	var rows []areaRow
	for _, area := range found.areaNames() {
		rows = append(rows, found.coverageRow(area, hand[area]))
	}
	slices.SortFunc(rows, func(a, b areaRow) int {
		if a.rank != b.rank {
			return a.rank - b.rank
		}
		return strings.Compare(a.area, b.area)
	})
	return tableLines([]string{"| | area | API vs main (latest run) | UI proven against main | not tested yet or failing |", "|---|---|---|---|---|"}, rows)
}

// areaRow is one area's rendered line and what the table sorts it by.
type areaRow struct {
	rank int
	area string
	line string
}

func tableLines(head []string, rows []areaRow) []string {
	lines := head
	for _, row := range rows {
		lines = append(lines, row.line)
	}
	return lines
}

func (found results) coverageRow(area string, hand []string) areaRow {
	kept := cellsAt(hand, 0, 1)
	ui, rest := kept[0], kept[1]
	if ui == "" {
		ui = "not tested yet"
	}
	proven := ui != "not tested yet"
	if flows := found.visual.areas[area]; flows != nil && flows.total > 0 {
		ui, proven = fmt.Sprintf("%d of %d flows pass", flows.pass, flows.total), flows.pass == flows.total
	}
	api, rank := apiCoverage(found.api.areas[area], proven)
	colour := []string{"🔴", "🟠", "🟢"}[rank]
	return areaRow{rank: rank, area: area, line: "| " + strings.Join([]string{colour, area, api, ui, rest}, " | ") + " |"}
}

// apiCoverage is an area's API cell and its rank: 2 when every scenario passes
// and the UI is proven, 1 at 90% or more, else 0.
func apiCoverage(scenarios *tally, proven bool) (string, int) {
	if scenarios == nil || scenarios.total == 0 {
		return "not tested yet", 0
	}
	api := fmt.Sprintf("%d/%d", scenarios.pass, scenarios.total)
	if failing := scenarios.total - scenarios.pass; failing > 0 {
		api += fmt.Sprintf(" · %d failing", failing)
	}
	switch {
	case scenarios.pass == scenarios.total && proven:
		return api, 2
	case scenarios.pass*10 >= scenarios.total*9:
		return api, 1
	}
	return api, 0
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
	var rows []areaRow
	for _, area := range found.areaNames() {
		if row, ok := found.defectRow(area, hand[area]); ok {
			rows = append(rows, row)
		}
	}
	slices.SortFunc(rows, func(a, b areaRow) int {
		if a.rank != b.rank {
			return b.rank - a.rank
		}
		return strings.Compare(a.area, b.area)
	})
	lines := tableLines([]string{"| area | what's wrong | failing | examples | status |", "|---|---|---|---|---|"}, rows)
	if len(rows) == 0 {
		lines = append(lines, "| none | nothing failed in the latest run | 0 | | |")
	}
	return lines
}

// defectRow is an area's failures, ranked by their count; ok is false when none failed.
func (found results) defectRow(area string, hand []string) (areaRow, bool) {
	var parts, ids []string
	if scenarios := found.api.areas[area]; scenarios != nil && len(scenarios.failing) > 0 {
		parts = append(parts, fmt.Sprintf("%d scenarios", len(scenarios.failing)))
		ids = append(ids, scenarios.failing...)
	}
	if flows := found.visual.areas[area]; flows != nil && len(flows.failing) > 0 {
		parts = append(parts, fmt.Sprintf("%d UI flows", len(flows.failing)))
		ids = append(ids, flows.failing...)
	}
	if len(ids) == 0 {
		return areaRow{}, false
	}
	kept := cellsAt(hand, 0, 1)
	status := cmpOr(kept[1], "open")
	return areaRow{rank: len(ids), area: area, line: "| " + strings.Join([]string{area, kept[0], strings.Join(parts, ", "), examples(ids), status}, " | ") + " |"}, true
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
	chunks := splitChunks(strings.Trim(body[start+len(sectionStart):end], "\n"))
	chunks[0].lines = preamble
	for index, spec := range tables {
		var at int
		chunks, at = chunkFor(chunks, tables, index)
		chunks[at].lines = replaceTable(chunks[at].lines, spec)
	}
	var lines []string
	for _, part := range chunks {
		lines = append(lines, part.lines...)
	}
	return body[:start] + sectionStart + "\n" + strings.Trim(strings.Join(lines, "\n"), "\n") + "\n" + body[end:], nil
}

// splitChunks cuts the section at each "### " heading; the first chunk has none.
func splitChunks(inner string) []chunk {
	chunks := []chunk{{}}
	for _, line := range strings.Split(inner, "\n") {
		if heading, ok := strings.CutPrefix(line, "### "); ok {
			chunks = append(chunks, chunk{heading: strings.TrimSpace(heading)})
		}
		chunks[len(chunks)-1].lines = append(chunks[len(chunks)-1].lines, line)
	}
	return chunks
}

// chunkFor finds the chunk under tables[index]'s heading, adding it after the
// previous table's chunk (or first, after the preamble) when it is missing.
func chunkFor(chunks []chunk, tables []tableSpec, index int) ([]chunk, int) {
	heading := tables[index].heading
	if at := findChunk(chunks, heading); at >= 0 {
		return chunks, at
	}
	at := 1
	if index > 0 {
		if previous := findChunk(chunks, tables[index-1].heading); previous >= 0 {
			at = previous + 1
		}
	}
	return slices.Insert(chunks, at, chunk{heading: heading, lines: []string{"### " + heading, ""}}), at
}

func findChunk(chunks []chunk, heading string) int {
	return slices.IndexFunc(chunks, func(candidate chunk) bool { return candidate.heading == heading })
}

// replaceTable swaps the first table in lines for the spec's, rendered with the hand
// cells of the rows it replaces; with no table, the new one goes under the heading.
func replaceTable(lines []string, spec tableSpec) []string {
	first, last := tableBounds(lines)
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

// tableBounds are the first and last lines of the first run of "|" lines, or -1, -1.
func tableBounds(lines []string) (first, last int) {
	first, last = -1, -1
	for index, line := range lines {
		if !strings.HasPrefix(line, "|") {
			if first >= 0 {
				break
			}
			continue
		}
		if first < 0 {
			first = index
		}
		last = index
	}
	return first, last
}

func splitCells(line string) []string {
	cells := strings.Split(strings.Trim(strings.TrimSpace(line), "|"), "|")
	for index := range cells {
		cells[index] = strings.TrimSpace(cells[index])
	}
	return cells
}
