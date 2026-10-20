package redteam

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	scenario "github.com/langwatch/scenario/go"
)

// Environment variables of the report.
const (
	// EnvReport set to "0" turns the automatic report off.
	EnvReport = "SCENARIO_REDTEAM_REPORT"
	// EnvReportDir overrides the batch directory of the reports.
	EnvReportDir = "SCENARIO_REDTEAM_REPORT_DIR"
)

// ReportOptions describe a run to save with SaveReport.
type ReportOptions struct {
	// Result is the outcome of the run.
	Result *scenario.ScenarioResult
	// Agent is the red-team agent of the run.
	Agent *Agent
	// TestName names the report, usually the scenario name.
	TestName string
	// Config is the scenario configuration; its description and the
	// criteria of its judge go into the report.
	Config scenario.ScenarioConfig
	// Elapsed is the wall time of the run; zero is reported as unknown.
	Elapsed time.Duration
	// Error marks the run as errored.
	Error string
	// OutDir replaces the batch directory.
	OutDir string
}

// report is the JSON shape the red-team dashboard (scenario redteam-report)
// reads, shared with the Python and JS SDKs. The analysis fields are filled
// by the dashboard on demand.
type report struct {
	TestName          string            `json:"test_name"`
	Description       string            `json:"description"`
	Strategy          string            `json:"strategy"`
	Target            string            `json:"target"`
	TotalTurns        int               `json:"total_turns"`
	AttackerModel     string            `json:"attacker_model"`
	MetapromptModel   string            `json:"metaprompt_model"`
	Criteria          []string          `json:"criteria"`
	Status            string            `json:"status"`
	Success           bool              `json:"success"`
	Reasoning         string            `json:"reasoning"`
	PassedCriteria    []string          `json:"passed_criteria"`
	FailedCriteria    []string          `json:"failed_criteria"`
	TotalTime         *float64          `json:"total_time"`
	AgentTime         *float64          `json:"agent_time"`
	Messages          []json.RawMessage `json:"messages"`
	FailingTurnIndex  *int              `json:"failing_turn_index"`
	FailureSummary    string            `json:"failure_summary"`
	Suggestions       []string          `json:"suggestions"`
	Severity          string            `json:"severity"`
	SeverityRationale string            `json:"severity_rationale"`
	BreakSeverity     string            `json:"break_severity"`
	BreakRationale    string            `json:"break_rationale"`
	Timestamp         int64             `json:"timestamp"`
	AnalysisPending   bool              `json:"analysis_pending"`
}

var batchDir struct {
	sync.Mutex
	path string
}

// currentBatchDir is the directory of this process's reports, created on
// first use: SCENARIO_REDTEAM_REPORT_DIR, else
// ./redteam-reports/<UTC yyyymmdd_hhmmss>.
func currentBatchDir() (string, error) {
	batchDir.Lock()
	defer batchDir.Unlock()
	if batchDir.path != "" {
		return batchDir.path, nil
	}
	dir := os.Getenv(EnvReportDir)
	if dir == "" {
		dir = filepath.Join("redteam-reports", time.Now().UTC().Format("20060102_150405"))
	}
	dir, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	batchDir.path = dir
	return dir, nil
}

// SaveReport writes the run as JSON for the red-team dashboard and returns
// the file path. It returns "" without writing when SCENARIO_REDTEAM_REPORT
// is "0". Runs that include a red-team agent save their report
// automatically when they end.
func SaveReport(opts ReportOptions) (string, error) {
	if os.Getenv(EnvReport) == "0" {
		return "", nil
	}
	dir := opts.OutDir
	var err error
	if dir == "" {
		dir, err = currentBatchDir()
	} else {
		dir, err = filepath.Abs(dir)
	}
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	now := time.Now()
	rep := buildReport(opts, now)
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(rep); err != nil {
		return "", err
	}
	// Encode ends with a newline JSON.stringify does not write.
	data := bytes.TrimSuffix(buf.Bytes(), []byte{'\n'})
	path := filepath.Join(dir, strconv.FormatInt(now.UnixMilli(), 10)+"_"+slugify(opts.TestName)+"_"+rep.Strategy+".json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func buildReport(opts ReportOptions, now time.Time) report {
	result := opts.Result
	if result == nil {
		result = &scenario.ScenarioResult{}
	}
	status := "broken"
	switch {
	case opts.Error != "":
		status = "errored"
	case result.Success:
		status = "held"
	}
	breakSeverity := "significant"
	if status == "held" {
		breakSeverity = "none"
	}
	reasoning := result.Reasoning
	if reasoning == "" && opts.Error != "" {
		reasoning = "ERROR: " + opts.Error
	}
	messages := make([]json.RawMessage, len(result.Messages))
	for i, m := range result.Messages {
		messages[i] = scenario.AppendMessageJSON(nil, m)
	}
	rep := report{
		TestName:        opts.TestName,
		Description:     opts.Config.Description,
		Criteria:        judgeCriteria(opts.Config.Agents),
		Status:          status,
		Success:         result.Success,
		Reasoning:       reasoning,
		PassedCriteria:  nonNil(result.MetCriteria),
		FailedCriteria:  nonNil(result.UnmetCriteria),
		Messages:        messages,
		Suggestions:     []string{},
		Severity:        "medium",
		BreakSeverity:   breakSeverity,
		Timestamp:       now.UnixMilli(),
		AnalysisPending: true,
		Strategy:        "unknown",
	}
	if opts.Elapsed > 0 {
		s := opts.Elapsed.Seconds()
		rep.TotalTime = &s
	}
	if result.AgentTime > 0 {
		s := result.AgentTime.Seconds()
		rep.AgentTime = &s
	}
	if a := opts.Agent; a != nil {
		attacker, metaprompt := a.models()
		rep.Strategy = reportStrategyName(a.cfg.Strategy)
		rep.Target = a.cfg.Target
		rep.TotalTurns = a.cfg.TotalTurns
		rep.AttackerModel = attacker.Model
		rep.MetapromptModel = metaprompt.Model
	}
	return rep
}

// judgeCriteria returns the criteria of the first agent that has any.
func judgeCriteria(agents []scenario.AgentAdapter) []string {
	for _, a := range agents {
		if p, ok := a.(scenario.CriteriaProvider); ok {
			return nonNil(p.Criteria())
		}
	}
	return []string{}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// reportStrategyName is "crescendo", "goat", or the lower-cased type name
// without "strategy".
func reportStrategyName(s Strategy) string {
	name := strings.ToLower(strategyTypeName(s))
	switch {
	case strings.Contains(name, "crescendo"):
		return "crescendo"
	case strings.Contains(name, "goat"):
		return "goat"
	}
	if name = strings.Replace(name, "strategy", "", 1); name != "" {
		return name
	}
	return "unknown"
}

// slugify lower-cases s, collapses every run of other characters than a-z
// and 0-9 to "_", trims one "_" at each end and keeps 80 bytes; "run" when
// nothing is left.
func slugify(s string) string {
	s = strings.ToLower(s)
	b := make([]byte, 0, len(s))
	sep := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' {
			b = append(b, c)
			sep = false
			continue
		}
		if !sep {
			b = append(b, '_')
			sep = true
		}
	}
	if len(b) > 0 && b[0] == '_' {
		b = b[1:]
	}
	if len(b) > 0 && b[len(b)-1] == '_' {
		b = b[:len(b)-1]
	}
	if len(b) > 80 {
		b = b[:80]
	}
	if len(b) == 0 {
		return "run"
	}
	return string(b)
}

// reportKey is the extension key of the report.
const reportKey = "redteam.report"

// reportExtension saves the report of a run once it stopped.
type reportExtension struct{ agent *Agent }

// Key implements scenario.Extension.
func (reportExtension) Key() string { return reportKey }

// Stop implements scenario.RunStopper. A failed save is logged and never
// fails the run.
func (e reportExtension) Stop(_ context.Context, ex *scenario.Executor) {
	result := ex.Result()
	if result == nil {
		return
	}
	cfg := ex.Config()
	_, err := SaveReport(ReportOptions{
		Result:   result,
		Agent:    e.agent,
		TestName: cfg.Name,
		Config:   cfg,
		Elapsed:  result.TotalTime,
		Error:    result.Error,
	})
	if err != nil {
		slog.Default().Warn("[scenario] red-team report save failed: " + err.Error())
	}
}
