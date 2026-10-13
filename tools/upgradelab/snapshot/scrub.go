package snapshot

import (
	"bufio"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
)

// Cell is one captured value with where it came from; the scrub reports the place, never the value.
type Cell struct {
	Table  string
	Column string
	Value  string
}

// Finding names a table, a column and the detector that fired. It never carries the value.
type Finding struct {
	Table    string
	Column   string
	Detector string
}

// ScrubError refuses a snapshot (plan §4.4 step 4).
type ScrubError struct{ Findings []Finding }

func (scrubError *ScrubError) Error() string {
	places := make([]string, 0, len(scrubError.Findings))
	for _, finding := range scrubError.Findings {
		places = append(places, fmt.Sprintf("%s.%s (%s)", finding.Table, finding.Column, finding.Detector))
	}
	return fmt.Sprintf("scrub refused the snapshot: %d secret finding(s): %s", len(places), strings.Join(places, "; "))
}

var detectors = []struct {
	name    string
	pattern *regexp.Regexp
}{
	{"provider api key (sk-)", regexp.MustCompile(`sk-[A-Za-z0-9_-]{20,}`)},
	{"stripe live key", regexp.MustCompile(`\b[rs]k_live_[A-Za-z0-9]{16,}`)},
	{"aws access key id", regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`)},
	{"github token", regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{36,}`)},
	{"google api key", regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}`)},
	{"slack token", regexp.MustCompile(`\bxox[abposr]-[A-Za-z0-9-]{10,}`)},
	{"private key", regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`)},
}

// Scrubber finds secrets in captured cells. Allow holds the shape's exact test values; Forbidden
// maps a producer secret-named variable to its value, refused anywhere it appears.
// ponytail: in-process detectors only; gitleaks over the rendered dumps is the next step.
type Scrubber struct {
	Allow     []string
	Forbidden map[string]string
}

// scan adds the findings in one cell to seen.
func (scrubber Scrubber) scan(cell Cell, seen map[Finding]bool) {
	for _, detector := range detectors {
		for _, match := range detector.pattern.FindAllString(cell.Value, -1) {
			if !slices.Contains(scrubber.Allow, match) {
				seen[Finding{Table: cell.Table, Column: cell.Column, Detector: detector.name}] = true
			}
		}
	}
	for name, value := range scrubber.Forbidden {
		if value != "" && strings.Contains(cell.Value, value) {
			seen[Finding{Table: cell.Table, Column: cell.Column, Detector: "value of " + name}] = true
		}
	}
}

// Scrub returns the findings in cells, one per table, column and detector, sorted.
func (scrubber Scrubber) Scrub(cells []Cell) []Finding {
	seen := map[Finding]bool{}
	for _, cell := range cells {
		scrubber.scan(cell, seen)
	}
	return sortedFindings(seen)
}

func sortedFindings(seen map[Finding]bool) []Finding {
	findings := make([]Finding, 0, len(seen))
	for finding := range seen {
		findings = append(findings, finding)
	}
	slices.SortFunc(findings, func(a, b Finding) int {
		return strings.Compare(a.Table+"."+a.Column+" "+a.Detector, b.Table+"."+b.Column+" "+b.Detector)
	})
	return findings
}

var copyHeader = regexp.MustCompile(`^COPY (\S+) \((.*)\) FROM stdin;$`)

// CopyCells streams `pg_restore -f -` output, visiting each COPY row's cells by table and column.
func CopyCells(reader io.Reader, visit func(Cell)) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 1<<20), 1<<30)
	var block copyBlock
	for scanner.Scan() {
		block = block.next(scanner.Text(), visit)
	}
	return scanner.Err()
}

// copyBlock is the COPY statement being read; an empty table means between blocks.
type copyBlock struct {
	table   string
	columns []string
}

func (block copyBlock) next(line string, visit func(Cell)) copyBlock {
	if block.table == "" {
		if match := copyHeader.FindStringSubmatch(line); len(match) == 3 {
			return copyBlock{table: unquoteIdent(match[1][strings.LastIndex(match[1], ".")+1:]), columns: strings.Split(match[2], ", ")}
		}
		return block
	}
	if line == `\.` {
		return copyBlock{}
	}
	for index, value := range strings.Split(line, "\t") {
		if index < len(block.columns) {
			visit(Cell{Table: block.table, Column: unquoteIdent(block.columns[index]), Value: value})
		}
	}
	return block
}

func unquoteIdent(ident string) string {
	return strings.ReplaceAll(strings.Trim(ident, `"`), `""`, `"`)
}

// TSVCells streams one table's TSVWithNames output, visiting each cell.
func TSVCells(table string, reader io.Reader, visit func(Cell)) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 1<<20), 1<<30)
	var columns []string
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), "\t")
		if columns == nil {
			columns = fields
			continue
		}
		for index, value := range fields {
			if index < len(columns) {
				visit(Cell{Table: table, Column: columns[index], Value: value})
			}
		}
	}
	return scanner.Err()
}
