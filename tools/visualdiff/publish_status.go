package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// The parity status lives in the pull request's body between these markers
// (README "The parity status"); a run rewrites only its flows' rows of the
// table under StatusFlowsHeading, and nothing else in the body.
const (
	StatusStart        = "<!-- parity-status:start -->"
	StatusEnd          = "<!-- parity-status:end -->"
	StatusFlowsHeading = "### visualdiff flows"
)

// verdictStates are the status legend's marks, worst first.
var verdictStates = []struct {
	verdict Verdict
	state   string
}{
	{VerdictBroken, "❌"}, {VerdictBrokenBoth, "❔"}, {VerdictLayoutOnly, "🟡"}, {VerdictUnproven, "⬜"}, {VerdictWorks, "✅"},
}

// flowStatus is one flow's "last result" and "state" cells.
type flowStatus struct {
	result string
	state  string
}

// FlowStatuses folds each flow's verdicts over its editions: the result names
// every edition's verdict and first failure, the state is the worst one's.
func FlowStatuses(verdicts []FlowVerdict) map[string]flowStatus {
	grouped, order := map[string][]FlowVerdict{}, []string{}
	for _, verdict := range verdicts {
		if grouped[verdict.Flow] == nil {
			order = append(order, verdict.Flow)
		}
		grouped[verdict.Flow] = append(grouped[verdict.Flow], verdict)
	}
	statuses := map[string]flowStatus{}
	for _, flow := range order {
		statuses[flow] = statusOf(grouped[flow])
	}
	return statuses
}

// statusOf is one flow's cell, each edition's verdict joined, and the state
// of the worst of them.
func statusOf(verdicts []FlowVerdict) flowStatus {
	var parts []string
	worst := len(verdictStates) - 1
	for _, verdict := range verdicts {
		parts = append(parts, verdictPart(verdict, len(verdicts) > 1))
		worst = min(worst, verdictRank(verdict.Verdict, worst))
	}
	return flowStatus{result: markdownCell(strings.Join(parts, "; ")), state: verdictStates[worst].state}
}

// verdictPart is one verdict's words, named by edition when the flow has several.
func verdictPart(verdict FlowVerdict, byEdition bool) string {
	part := string(verdict.Verdict)
	if len(verdict.Proof) > 0 {
		part += fmt.Sprintf(" (%d expects held)", len(verdict.Proof))
	}
	if verdict.FirstFailure != "" {
		part += ": " + head(verdict.FirstFailure)
	}
	if byEdition {
		part = string(verdict.Edition) + " " + part
	}
	return part
}

// verdictRank is the lowest rank in verdictStates below worst that names
// verdict, or worst when none does.
func verdictRank(verdict Verdict, worst int) int {
	for rank, entry := range verdictStates {
		if entry.verdict == verdict && rank < worst {
			worst = rank
		}
	}
	return worst
}

var headingCount = regexp.MustCompile(`\((\d+)\)`)

// SpliceFlowStatus sets the "last result" and "state" cells of each flow row
// the statuses name, appends a row for a flow with none, and leaves every
// other line, and everything outside the markers, byte for byte.
func SpliceFlowStatus(body string, statuses map[string]flowStatus) (string, error) {
	start, end := strings.Index(body, StatusStart), strings.Index(body, StatusEnd)
	if start < 0 || end < start {
		return body, errors.New("the body has no parity-status markers")
	}
	lines := strings.Split(body[start:end], "\n")
	table, err := findFlowsTable(lines)
	if err != nil {
		return body, err
	}
	seen := table.update(lines, statuses)
	added := table.missingRows(lines[table.header], statuses, seen)
	if len(added) > 0 {
		sort.Strings(added)
		lines = append(lines[:table.end], append(added, lines[table.end:]...)...)
		rows := table.end - table.header - 2 + len(added)
		lines[table.heading] = headingCount.ReplaceAllString(lines[table.heading], fmt.Sprintf("(%d)", rows))
	}
	return body[:start] + strings.Join(lines, "\n") + body[end:], nil
}

// flowsTable is where the flows table sits in the status lines.
type flowsTable struct {
	heading, header, end int
	columns              []string
	flow, result, state  int
}

func findFlowsTable(lines []string) (flowsTable, error) {
	table := flowsTable{}
	table.heading, table.header = locateFlowsTable(lines)
	if table.header < 0 || table.header+1 >= len(lines) {
		return table, errors.New("the status has no " + StatusFlowsHeading + " table")
	}
	table.end = table.header + 2
	for table.end < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[table.end]), "|") {
		table.end++
	}
	table.columns = splitRow(lines[table.header])
	table.flow, table.result, table.state = column(table.columns, "flow"), column(table.columns, "last result"), column(table.columns, "state")
	if table.flow < 0 || table.result < 0 || table.state < 0 {
		return table, errors.New("the flows table lacks a flow, last result or state column")
	}
	return table, nil
}

// locateFlowsTable is the line of the flows heading and of the first table
// row after it, each -1 when absent.
func locateFlowsTable(lines []string) (heading, header int) {
	heading, header = -1, -1
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if heading < 0 && strings.HasPrefix(trimmed, StatusFlowsHeading) {
			heading = index
		} else if heading >= 0 && header < 0 && strings.HasPrefix(trimmed, "|") {
			header = index
		}
	}
	return heading, header
}

// update writes each covered flow's status into its row and answers the flows
// it found.
func (table flowsTable) update(lines []string, statuses map[string]flowStatus) map[string]bool {
	seen := map[string]bool{}
	for index := table.header + 2; index < table.end; index++ {
		cells := splitRow(lines[index])
		if len(cells) != len(table.columns) {
			continue
		}
		flow := strings.Trim(cells[table.flow], " `")
		status, covered := statuses[flow]
		if !covered {
			continue
		}
		seen[flow] = true
		cells[table.result], cells[table.state] = status.result, status.state
		lines[index] = joinRow(cells, lines[index])
	}
	return seen
}

// missingRows is a new row, shaped like header, for each status no row held.
func (table flowsTable) missingRows(header string, statuses map[string]flowStatus, seen map[string]bool) []string {
	var added []string
	for flow, status := range statuses {
		if seen[flow] {
			continue
		}
		cells := make([]string, len(table.columns))
		cells[table.flow], cells[table.result], cells[table.state] = flow, status.result, status.state
		added = append(added, joinRow(cells, header))
	}
	return added
}

func column(columns []string, name string) int {
	for index, column := range columns {
		if strings.EqualFold(column, name) {
			return index
		}
	}
	return -1
}

// splitRow reads a table row's cells, trimmed; an escaped \| stays in its cell.
func splitRow(line string) []string {
	trimmed := strings.TrimSpace(line)
	trimmed = strings.TrimSuffix(strings.TrimPrefix(trimmed, "|"), "|")
	var cells []string
	var cell strings.Builder
	for index := 0; index < len(trimmed); index++ {
		if trimmed[index] == '|' && (index == 0 || trimmed[index-1] != '\\') {
			cells = append(cells, strings.TrimSpace(cell.String()))
			cell.Reset()
			continue
		}
		cell.WriteByte(trimmed[index])
	}
	return append(cells, strings.TrimSpace(cell.String()))
}

// joinRow writes cells as a row, keeping like's line ending.
func joinRow(cells []string, like string) string {
	row := "| " + strings.Join(cells, " | ") + " |"
	if strings.HasSuffix(like, "\r") {
		row += "\r"
	}
	return row
}

// publishStatus splices the run's flow verdicts into the PR body's status. A
// body without the markers is left alone, and said so.
func (gh ghClient) publishStatus(ctx context.Context, request PublishRequest, pr string) error {
	statuses := FlowStatuses(JudgeFlows(request.Rows))
	if len(statuses) == 0 {
		return nil
	}
	var out bytes.Buffer
	path := "repos/{owner}/{repo}/pulls/" + pr
	if err := gh.run(ctx, commandSpec{name: "gh", args: []string{"api", path, "--jq", ".body | @json"}, dir: gh.root}, &out); err != nil {
		return fmt.Errorf("publish: read PR #%s's body: %w", pr, err)
	}
	body, found := encodedBody(out.String())
	if !found {
		return fmt.Errorf("publish: PR #%s's body did not read back as JSON", pr)
	}
	spliced, err := SpliceFlowStatus(body, statuses)
	if err != nil {
		fmt.Fprintf(request.Stderr, "publish: status skipped, PR #%s: %v\n", pr, err)
		return nil
	}
	if spliced == body {
		return nil
	}
	file := filepath.Join(request.RunDir, "pr-body.md")
	if err := os.WriteFile(file, []byte(spliced), 0o600); err != nil {
		return err
	}
	if err := gh.run(ctx, commandSpec{name: "gh", args: []string{"api", path, "-X", "PATCH", "-F", "body=@" + file, "--jq", ".number"}, dir: gh.root}, &bytes.Buffer{}); err != nil {
		return fmt.Errorf("publish: update PR #%s's status: %w", pr, err)
	}
	fmt.Fprintf(request.Stderr, "publish: %d flow row(s) of PR #%s's status set\n", len(statuses), pr)
	return nil
}

// encodedBody is the one line of gh's output that decodes as a JSON string:
// gh's stderr shares the stream, and none of it may reach the body.
func encodedBody(output string) (string, bool) {
	for _, line := range strings.Split(output, "\n") {
		var body string
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &body) == nil {
			return body, true
		}
	}
	return "", false
}
