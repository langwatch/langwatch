package diffsuite

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// stdout is the suite's live view; plain text, so it greps the same on a tty and in a file.
var stdout io.Writer = os.Stdout

var (
	statusEvery  = 15 * time.Second
	tallyLine    = regexp.MustCompile(`flows passed|scenarios: [0-9]+ run`)
	progressLine = map[string]*regexp.Regexp{
		"api":     regexp.MustCompile(`[0-9]+ run`),
		"visual":  regexp.MustCompile(`flows passed|step`),
		"fuzzapi": regexp.MustCompile(`visits.*routes|requests`),
		"fuzzui":  regexp.MustCompile(`visits.*routes`),
	}
)

const statusWidth = 160

// noteLine records what a status line shows: the last progress match, else the last line.
func (tool *tool) noteLine(text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	tool.lastLine = text
	if pattern := progressLine[tool.name]; pattern != nil && pattern.MatchString(text) {
		tool.progress = text
	}
	if tallyLine.MatchString(text) {
		tool.tally = text
	}
}

// statusLine is one running tool: `[name] RUNNING 12m03s load 3.2 2.9 2.5: <latest>`.
func statusLine(tool *tool, elapsed time.Duration, load string) string {
	latest := strings.TrimSpace(tool.progress)
	if latest == "" {
		latest = strings.TrimSpace(tool.lastLine)
	}
	if latest == "" {
		latest = "(no output yet)"
	}
	line := fmt.Sprintf("[%s] RUNNING %s load %s: %s", tool.name, elapsed.Round(time.Second), load, latest)
	if len(line) > statusWidth {
		line = line[:statusWidth-3] + "..."
	}
	return line
}

// loadAverage reads the load figures out of `uptime`, macOS and Linux spellings alike.
func loadAverage(uptime string) string {
	_, after, ok := strings.Cut(uptime, "load average")
	if !ok {
		return "?"
	}
	_, after, _ = strings.Cut(after, ":")
	fields := strings.FieldsFunc(after, func(r rune) bool { return r == ' ' || r == ',' })
	if len(fields) > 3 {
		fields = fields[:3]
	}
	return cmpJoin(fields)
}

func cmpJoin(fields []string) string {
	if len(fields) == 0 {
		return "?"
	}
	return strings.Join(fields, " ")
}

// heartbeat prints one status line per running tool every statusEvery until finished closes.
func (suite *suite) heartbeat(finished <-chan struct{}) {
	ticker := time.NewTicker(statusEvery)
	defer ticker.Stop()
	for {
		select {
		case <-finished:
			return
		case <-ticker.C:
		}
		out, _ := exec.Command("uptime").Output()
		load := loadAverage(string(out))
		suite.mu.Lock()
		var lines []string
		for _, tool := range suite.tools {
			if !tool.done {
				lines = append(lines, statusLine(tool, time.Since(tool.began), load))
			}
		}
		suite.mu.Unlock()
		suite.eventsMu.Lock()
		for _, line := range lines {
			fmt.Fprintln(stdout, line)
		}
		suite.eventsMu.Unlock()
	}
}

// summaryTable is the closing table: tool, exit, duration and the last tally line.
func summaryTable(tools []*tool) string {
	var table strings.Builder
	fmt.Fprintf(&table, "%-12s %-5s %-10s %s\n", "TOOL", "EXIT", "DURATION", "HEADLINE")
	for _, tool := range tools {
		fmt.Fprintf(&table, "%-12s %-5d %-10s %s\n", tool.name, tool.exit, tool.took.Round(time.Second), strings.TrimSpace(tool.tally))
	}
	return table.String()
}
