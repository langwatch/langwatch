package diffsuite

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// findingsEvery is how often a fuzz tool's findings.jsonl is read for new lines.
var findingsEvery = 2 * time.Second

const reportLines = 50

var (
	apiVerdictLine    = regexp.MustCompile(`^(FAIL(?:-\w+)?|ERROR)\s+(\S+)\s+\((.*)\)\s*$`)
	apiStepLine       = regexp.MustCompile(`^\s+first failing step: .+$`)
	visualVerdictLine = regexp.MustCompile(`^(?:\[[0-9:]+\] )?(FAIL|UNPROVEN|ROUTE)\s+(\S+)`)
	countPair         = regexp.MustCompile(`(?i)(\d+) (pass|fail(?:-\w+)?|err(?:or)?)\b`)
	apiCountLine      = regexp.MustCompile(`^(?:\[[0-9:]+\] )?(?:scenarios(?: \d+/\d+|: \d+ run:)|worker: \d+ checked:)`)
	versionSegment    = regexp.MustCompile(`^v\d+$`)
)

// item is one failing id or distinct finding, filed under a module or route family.
type item struct{ line, group string }

// toolResults is what one tool's output has shown so far.
type toolResults struct {
	pass, fail, errs int
	failing          []item
	findings         []item
	latency          int // latency findings, counted apart: load makes them noise
	seen             map[string]bool
	dir              string // the fuzz run directory whose findings.jsonl is followed
	offset           int64
}

func (r *toolResults) mark(key string) bool {
	if r.seen == nil {
		r.seen = map[string]bool{}
	}
	if r.seen[key] {
		return false
	}
	r.seen[key] = true
	return true
}

// family names the module or route family of a path (its first real segment), else of an id (its first word).
func family(text string) string {
	if !strings.Contains(text, "/") {
		return cmpOr(strings.SplitN(text, "-", 2)[0], "other")
	}
	path, _, _ := strings.Cut(text, "?")
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "api" || versionSegment.MatchString(segment) || strings.ContainsAny(segment[:1], "[{") {
			continue
		}
		return "/" + segment
	}
	return "other"
}

func cmpOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// result files one output line and answers the line to stream, when the events filter does not print it already.
func (tool *tool) result(text string) string {
	if streamed, ok := tool.results.verdict(text); ok {
		return streamed
	}
	if apiStepLine.MatchString(text) {
		return strings.TrimSpace(text)
	}
	tool.results.tally(text)
	return ""
}

// verdict files an api or visual verdict line; ok is false for any other line.
func (r *toolResults) verdict(text string) (streamed string, ok bool) {
	if match := apiVerdictLine.FindStringSubmatch(text); match != nil {
		endpoint := cmpOr(strings.TrimSpace(strings.Split(match[3], ",")[0]), match[2])
		if r.mark("fail " + match[2]) {
			r.failing = append(r.failing, item{match[1] + " " + match[2], family(fields(endpoint))})
		}
		return "", true
	}
	match := visualVerdictLine.FindStringSubmatch(text)
	if match == nil {
		return "", false
	}
	if !r.mark(match[1] + " " + match[2]) {
		return "", true
	}
	r.failing = append(r.failing, item{match[1] + " " + match[2], family(match[2])})
	if match[1] != "FAIL" {
		return strings.TrimSpace(text), true
	}
	return "", true
}

// tally files the counts and the findings directory a line may carry.
func (r *toolResults) tally(text string) {
	if match := flowTally.FindStringSubmatch(text); match != nil {
		r.pass, r.fail = number(match[1]), number(match[2])-number(match[1])
	}
	if apiCountLine.MatchString(text) {
		r.countPairs(text)
	}
	if match := fuzzDir.FindStringSubmatch(text); match != nil {
		dir := match[1]
		if strings.HasSuffix(dir, ".json") {
			dir = filepath.Dir(dir)
		}
		r.dir = dir
	}
}

// fields answers the path in an endpoint such as `GET /api/x`.
func fields(endpoint string) string {
	for _, part := range strings.Fields(endpoint) {
		if strings.HasPrefix(part, "/") {
			return part
		}
	}
	return endpoint
}

func (r *toolResults) countPairs(text string) {
	r.pass, r.fail, r.errs = 0, 0, 0
	for _, match := range countPair.FindAllStringSubmatch(text, -1) {
		count, kind := number(match[1]), strings.ToLower(match[2])
		switch {
		case kind == "pass":
			r.pass += count
		case strings.HasPrefix(kind, "fail"):
			r.fail += count
		default:
			r.errs += count
		}
	}
}

// absorb reads findings.jsonl lines and answers a streamed line for each distinct new finding.
func (r *toolResults) absorb(chunk []byte) []string {
	var lines []string
	for _, raw := range strings.Split(string(chunk), "\n") {
		var record struct {
			Oracle, Route, Signature, Method, Message string
			Status                                    int
			Finding                                   bool
		}
		if json.Unmarshal([]byte(raw), &record) != nil || !record.Finding || !r.mark("finding "+record.Signature) {
			continue
		}
		where := strings.TrimSpace(record.Method + " " + record.Route)
		latency := record.Oracle == "latency"
		status := ""
		if record.Status != 0 {
			status = fmt.Sprintf(" status %d", record.Status)
		}
		line := fmt.Sprintf("FINDING #%d %s %s%s: %s", len(r.findings)+r.latency+1, record.Oracle, where, status, oneLine(record.Message))
		if latency {
			r.latency++
		} else {
			r.findings = append(r.findings, item{fmt.Sprintf("%s %s%s", record.Oracle, where, status), family(record.Route)})
		}
		lines = append(lines, line)
	}
	return lines
}

func oneLine(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if len(text) > 140 {
		return text[:137] + "..."
	}
	return text
}

// readNew answers the whole lines appended to path after offset, and the new offset.
func readNew(path string, offset int64) ([]byte, int64) {
	body, err := os.ReadFile(path) // #nosec G304 -- the directory fuzz said it wrote.
	if err != nil || int64(len(body)) <= offset {
		return nil, offset
	}
	chunk := body[offset:]
	end := strings.LastIndexByte(string(chunk), '\n') + 1
	return chunk[:end], offset + int64(end)
}

// say streams one result line to stdout only; events.log keeps its failure mirror.
func (suite *suite) say(name, text string) {
	suite.eventsMu.Lock()
	defer suite.eventsMu.Unlock()
	fmt.Fprintf(stdout, "[%s] %s\n", name, text)
}

// drain streams the findings a fuzz tool has written since the last read.
func (suite *suite) drain(tool *tool) {
	suite.mu.Lock()
	dir, offset := tool.results.dir, tool.results.offset
	suite.mu.Unlock()
	if dir == "" {
		return
	}
	chunk, next := readNew(filepath.Join(dir, "findings.jsonl"), offset)
	suite.mu.Lock()
	tool.results.offset = next
	lines := tool.results.absorb(chunk)
	suite.mu.Unlock()
	for _, line := range lines {
		suite.say(tool.name, line)
	}
}

// followFindings drains a tool's findings file until its output ends, then once more.
func (suite *suite) followFindings(tool *tool) {
	ticker := time.NewTicker(findingsEvery)
	defer ticker.Stop()
	for {
		select {
		case <-tool.scanned:
			suite.drain(tool)
			return
		case <-ticker.C:
			suite.drain(tool)
		}
	}
}

// summaryReport is the closing account per tool: counts, then failing ids and distinct findings by group.
func summaryReport(tools []*tool) string {
	var out strings.Builder
	for _, tool := range tools {
		r := &tool.results
		fmt.Fprintf(&out, "\n[%s] pass %d fail %d error %d distinct findings %d latency %d\n", tool.name, r.pass, r.fail, r.errs, len(r.findings), r.latency)
		budget := reportLines
		budget = groupLines(&out, itemGroup{label: "failing", items: r.failing, file: tool.name + ".log"}, budget)
		groupLines(&out, itemGroup{label: "finding", items: r.findings, file: filepath.Join(r.dir, "findings.jsonl")}, budget)
	}
	return out.String()
}

// itemGroup is one kind of item in the report: its label, the items and the
// file that holds the ones the budget hides.
type itemGroup struct {
	label string
	items []item
	file  string
}

func groupLines(out *strings.Builder, group itemGroup, budget int) int {
	groups, names := groupedItems(group.items)
	hidden := 0
	for index, name := range names {
		if budget < 1 || (budget == 1 && (index < len(names)-1 || hidden > 0)) {
			hidden += len(groups[name])
			continue
		}
		fmt.Fprintf(out, "  %s %s (%d): %s\n", group.label, name, len(groups[name]), strings.Join(groups[name], "; "))
		budget--
	}
	if hidden > 0 {
		fmt.Fprintf(out, "  %d more %s in %s\n", hidden, group.label, group.file)
		budget--
	}
	return budget
}

// groupedItems groups item lines by group, and orders the groups largest first, then by name.
func groupedItems(items []item) (map[string][]string, []string) {
	groups := map[string][]string{}
	for _, entry := range items {
		groups[entry.group] = append(groups[entry.group], entry.line)
	}
	names := make([]string, 0, len(groups))
	for name := range groups {
		names = append(names, name)
	}
	slices.SortFunc(names, func(a, b string) int {
		if len(groups[a]) != len(groups[b]) {
			return len(groups[b]) - len(groups[a])
		}
		return strings.Compare(a, b)
	})
	return groups, names
}
