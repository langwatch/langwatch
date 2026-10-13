package scenariotest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	scenario "github.com/langwatch/scenario/go"
)

// Status is the outcome of one scenario run, as the run finished event
// reports it.
type Status string

// Statuses.
const (
	StatusSuccess Status = "SUCCESS"
	StatusFailed  Status = "FAILED"
	StatusError   Status = "ERROR"
)

// Entry is one scenario run of the report.
type Entry struct {
	Test     string
	Name     string
	Status   Status
	Duration time.Duration
	Result   *scenario.ScenarioResult
	Err      error
}

// Reporter collects the runs of a test binary. It is safe for concurrent
// use by parallel tests.
type Reporter struct {
	mu      sync.Mutex
	entries []Entry
}

var defaultReporter Reporter

// DefaultReporter is the reporter Run records into and Main prints.
func DefaultReporter() *Reporter { return &defaultReporter }

// Add records a run.
func (r *Reporter) Add(e Entry) {
	r.mu.Lock()
	r.entries = append(r.entries, e)
	r.mu.Unlock()
}

// Entries returns the runs recorded so far, in completion order.
func (r *Reporter) Entries() []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Entry(nil), r.entries...)
}

func statusOf(res *scenario.ScenarioResult, err error) Status {
	switch {
	case err != nil || res == nil || res.Error != "":
		return StatusError
	case res.Success:
		return StatusSuccess
	}
	return StatusFailed
}

// Run runs the scenario as part of t. The chat log and the verdict go to the
// test log; a failed verdict fails t with the reasoning, and an error stops
// t. The run is recorded in the default reporter.
func Run(t testing.TB, cfg scenario.ScenarioConfig, opts ...scenario.RunOption) *scenario.ScenarioResult {
	t.Helper()
	ctx := context.Background()
	if c, ok := t.(interface{ Context() context.Context }); ok {
		ctx = c.Context()
	}
	res, err := scenario.Run(ctx, cfg, opts...)
	entry := Entry{Test: t.Name(), Name: cfg.Name, Status: statusOf(res, err), Result: res, Err: err}
	if res != nil {
		entry.Duration = res.TotalTime
	}
	DefaultReporter().Add(entry)

	var b strings.Builder
	WriteRun(&b, cfg, res)
	t.Log("\n" + b.String())
	switch {
	case err != nil:
		t.Fatalf("scenario %q: %v", cfg.Name, err)
	case !res.Success:
		t.Errorf("scenario %q failed: %s", cfg.Name, res.Reasoning)
	}
	return res
}

// Main runs the tests and prints the scenario report, returning the exit
// code for os.Exit.
func Main(m *testing.M) int {
	code := m.Run()
	DefaultReporter().WriteReport(os.Stdout)
	return code
}

// isBinary matches /^[A-Za-z0-9+\/]+=*$/ over more than 50 characters.
func isBinary(s string) bool {
	if len(s) <= 50 {
		return false
	}
	end := len(s)
	for end > 0 && s[end-1] == '=' {
		end--
	}
	if end == 0 {
		return false
	}
	for i := 0; i < end; i++ {
		c := s[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/') {
			return false
		}
	}
	return true
}

// formatContent masks binary payloads and shortens long text, like the JS
// reporter.
func formatContent(m scenario.Message) string {
	if len(m.Parts) > 0 {
		for _, p := range m.Parts {
			if p.Type != scenario.PartText && (len(p.Data) > 0 || isBinary(p.URL)) {
				return "[Content with binary data]"
			}
		}
	}
	text := m.Text()
	if isBinary(text) {
		return "[Binary data]"
	}
	if r := []rune(text); len(r) > 100 {
		return string(r[:100]) + "..."
	}
	return text
}

func indent(s string) string {
	return "  " + strings.ReplaceAll(s, "\n", "\n  ")
}

func prettyJSON(s string) string {
	var v any
	if json.Unmarshal([]byte(s), &v) != nil {
		return s
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return s
	}
	return string(b)
}

// WriteRun writes the chat log and verdict of one run.
func WriteRun(w io.Writer, cfg scenario.ScenarioConfig, res *scenario.ScenarioResult) {
	fmt.Fprintf(w, "--- Scenario Run: %s ---\n", cfg.Name)
	fmt.Fprintf(w, "Description: %s\n", cfg.Description)
	if res == nil {
		fmt.Fprintln(w, "-----------------------------")
		return
	}
	if len(res.Messages) > 0 {
		fmt.Fprint(w, "Chat log:\n\n")
		for _, m := range res.Messages {
			writeMessage(w, m)
		}
	}
	fmt.Fprintln(w, "--- Verdict ---")
	fmt.Fprintf(w, "Status: %s\n", statusOf(res, nil))
	verdict := "failure"
	if res.Success {
		verdict = "success"
	}
	fmt.Fprintf(w, "Verdict: %s\n", verdict)
	if res.Reasoning != "" {
		fmt.Fprintf(w, "Reasoning: %s\n", res.Reasoning)
	}
	if len(res.MetCriteria) > 0 {
		fmt.Fprintf(w, "Met criteria: %s\n", strings.Join(res.MetCriteria, ", "))
	}
	if len(res.UnmetCriteria) > 0 {
		fmt.Fprintf(w, "Unmet criteria: %s\n", strings.Join(res.UnmetCriteria, ", "))
	}
	for _, e := range res.Evaluations {
		details := ""
		if e.Details != "" {
			details = " (" + e.Details + ")"
		}
		fmt.Fprintf(w, "Evaluator %s: %s%s\n", e.Name, e.Status, details)
	}
	if res.Error != "" {
		fmt.Fprintf(w, "Error: %s\n", res.Error)
	}
	fmt.Fprintln(w, "-----------------------------")
}

func writeMessage(w io.Writer, m scenario.Message) {
	switch m.Role {
	case scenario.RoleAssistant:
		for _, tc := range m.ToolCalls {
			fmt.Fprintf(w, "ToolCall(%s):\n\n%s\n\n", tc.Name, indent(prettyJSON(tc.Arguments)))
		}
		if len(m.ToolCalls) > 0 && m.Text() == "" {
			return
		}
		fmt.Fprintf(w, "Assistant: %s\n", formatContent(m))
	case scenario.RoleUser:
		fmt.Fprintf(w, "User: %s\n", formatContent(m))
	case scenario.RoleTool:
		fmt.Fprintf(w, "ToolResult:\n\n%s\n\n", indent(prettyJSON(m.Text())))
	default:
		fmt.Fprintf(w, "%s: %s\n", m.Role, formatContent(m))
	}
}

// WriteReport writes the summary of every recorded run; nothing when no
// scenario ran.
func (r *Reporter) WriteReport(w io.Writer) {
	entries := r.Entries()
	if len(entries) == 0 {
		return
	}
	passed := 0
	for _, e := range entries {
		if e.Status == StatusSuccess {
			passed++
		}
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "=== Scenario Test Report ===")
	fmt.Fprintf(w, "Total Scenarios: %d\n", len(entries))
	fmt.Fprintf(w, "Passed: %d\n", passed)
	fmt.Fprintf(w, "Failed: %d\n", len(entries)-passed)
	fmt.Fprintf(w, "Success Rate: %s%%\n", strconv.FormatFloat(float64(passed)*100/float64(len(entries)), 'f', 1, 64))
	for i, e := range entries {
		fmt.Fprintln(w)
		fmt.Fprintf(w, "%d. %s - %s in %.2fs\n", i+1, e.Name, e.Status, e.Duration.Seconds())
		if e.Result != nil {
			if e.Result.Reasoning != "" {
				fmt.Fprintf(w, "  Reasoning: %s\n", e.Result.Reasoning)
			}
			met, unmet := len(e.Result.MetCriteria), len(e.Result.UnmetCriteria)
			fmt.Fprintf(w, "  Success Criteria: %d/%d\n", met, met+unmet)
		} else if e.Err != nil {
			fmt.Fprintf(w, "  Error: %v\n", e.Err)
		}
	}
	fmt.Fprintln(w)
}
