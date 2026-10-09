package visualdiff

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ShardsDir is where a merge finds the shards' run directories, one per
// shard under <run-dir>/shards/<name>, as CI downloads their artifacts.
const ShardsDir = "shards"

// MergeRequest is one `visualdiff merge`.
type MergeRequest struct {
	RunDir       string
	Shards       int
	BaseRef      string
	CandidateRef string
}

// MergeResult is what the merged run says: its rows, its findings (uncovered
// routes included), why it is partial, and which shards broke.
type MergeResult struct {
	Rows     []Row
	Findings int
	Partial  []string
	Broken   []string
}

// ExitCode is the merged run's exit status, as run's: 2 when a shard broke or
// none left a report, else 1 on findings, else 0.
func (result MergeResult) ExitCode() int {
	switch {
	case len(result.Broken) > 0 || len(result.Rows) == 0:
		return ExitOperational
	case result.Findings > 0:
		return ExitFindings
	default:
		return ExitClean
	}
}

// editionReport is one edition's report/<edition>/findings.json.
type editionReport struct {
	Meta ReportMeta `json:"meta"`
	Rows []Row      `json:"rows"`
}

// shardRun is one shard's run directory as the merge read it.
type shardRun struct {
	name     string
	dir      string
	exitCode string
	outcome  Outcome
	found    bool
	reports  map[Edition]editionReport
}

// Merge combines the shards under <run-dir>/shards into one run in run-dir:
// a report per edition, findings.jsonl, summary.txt and outcome.json. Each
// row keeps addressing its screenshots inside its own shard's directory.
func Merge(request MergeRequest) (MergeResult, error) {
	shards, err := readShards(filepath.Join(request.RunDir, ShardsDir))
	if err != nil {
		return MergeResult{}, err
	}
	result, merged := MergeResult{}, mergedReports{}
	var coverage *Coverage
	for _, shard := range shards {
		result.Partial = append(result.Partial, shard.partial()...)
		if shard.broken() {
			result.Broken = append(result.Broken, fmt.Sprintf("shard %s exited %s: the run could not complete", shard.name, shard.exitCode))
		}
		merged.add(shard.reports)
		if coverage == nil {
			coverage = shard.outcome.Coverage
		}
	}
	if missing := request.Shards - len(shards); missing > 0 {
		result.Partial = append(result.Partial, fmt.Sprintf("%d of %d shards left nothing to merge", missing, request.Shards))
	}
	result.Rows = merged.rows()
	result.Findings = CountFindings(result.Rows)
	if coverage != nil {
		result.Findings += len(coverage.Uncovered())
	}
	return result, writeMerged(request, mergeOutput{result: result, merged: merged, shards: shards, coverage: coverage})
}

// readShards reads every shard directory, in name order.
func readShards(dir string) ([]shardRun, error) {
	entries, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	var shards []shardRun
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		shard, err := readShard(entry.Name(), filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		shards = append(shards, shard)
	}
	return shards, nil
}

func readShard(name, dir string) (shardRun, error) {
	shard := shardRun{name: name, dir: dir, exitCode: "none"}
	if code, err := os.ReadFile(filepath.Join(dir, ExitCodeFile)); err == nil { // #nosec G304 -- CI wrote it under the shard's directory.
		shard.exitCode = strings.TrimSpace(string(code))
	}
	outcome, found, err := ReadOutcome(dir)
	if err != nil {
		return shard, fmt.Errorf("shard %s: %w", name, err)
	}
	shard.outcome, shard.found = outcome, found
	shard.reports, err = readEditionReports(dir)
	if err != nil {
		return shard, fmt.Errorf("shard %s: %w", name, err)
	}
	for edition, report := range shard.reports {
		rebaseRows(report.Rows, outcome.RunDir, dir)
		shard.reports[edition] = report
	}
	return shard, nil
}

// broken is a shard whose run itself failed: exit 2, or 3 for an error streak.
func (shard shardRun) broken() bool {
	return shard.exitCode == "2" || shard.exitCode == "3"
}

// partial says why this shard captured less than it planned.
func (shard shardRun) partial() []string {
	var reasons []string
	switch {
	case len(shard.reports) == 0:
		reasons = append(reasons, fmt.Sprintf("shard %s left no report (exit %s)", shard.name, shard.exitCode))
	case !shard.outcome.Finished:
		reasons = append(reasons, fmt.Sprintf("shard %s did not finish (exit %s)", shard.name, shard.exitCode))
	}
	for _, reason := range shard.outcome.Partial {
		reasons = append(reasons, fmt.Sprintf("shard %s: %s", shard.name, reason))
	}
	return reasons
}

// readEditionReports reads every report/<edition>/findings.json under dir.
func readEditionReports(dir string) (map[Edition]editionReport, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "report", "*", "findings.json"))
	if err != nil {
		return nil, err
	}
	reports := map[Edition]editionReport{}
	for _, path := range paths {
		encoded, err := os.ReadFile(path) // #nosec G304 -- a report this tool wrote under the shard's directory.
		if err != nil {
			return nil, err
		}
		var report editionReport
		if err := json.Unmarshal(encoded, &report); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		reports[Edition(filepath.Base(filepath.Dir(path)))] = report
	}
	return reports, nil
}

// rebaseRows points every image path under the run directory the shard ran
// in at the directory the merge found the shard in.
func rebaseRows(rows []Row, from, to string) {
	if from == "" {
		return
	}
	for index := range rows {
		row := &rows[index]
		row.DiffFile = rebasePath(row.DiffFile, from, to)
		for _, capture := range []*Capture{row.Base, row.Candidate} {
			if capture != nil {
				capture.Screenshot = rebasePath(capture.Screenshot, from, to)
			}
		}
	}
}

func rebasePath(path, from, to string) string {
	relative, err := filepath.Rel(from, path)
	if path == "" || err != nil || strings.HasPrefix(relative, "..") {
		return path
	}
	return filepath.Join(to, relative)
}

// mergedReports gathers each edition's rows from every shard, and the first
// shard's report header.
type mergedReports map[Edition]*editionReport

func (merged mergedReports) add(reports map[Edition]editionReport) {
	for edition, report := range reports {
		if merged[edition] == nil {
			merged[edition] = &editionReport{Meta: report.Meta}
		}
		merged[edition].Rows = append(merged[edition].Rows, report.Rows...)
	}
}

func (merged mergedReports) editions() []Edition {
	editions := make([]Edition, 0, len(merged))
	for edition := range merged {
		editions = append(editions, edition)
	}
	sort.Slice(editions, func(a, b int) bool { return editions[a] < editions[b] })
	return editions
}

// rows sorts each edition's rows worst-first and answers them all, editions in name order.
func (merged mergedReports) rows() []Row {
	var rows []Row
	for _, edition := range merged.editions() {
		sortRows(merged[edition].Rows)
		rows = append(rows, merged[edition].Rows...)
	}
	return rows
}

// mergeOutput is what writeMerged writes.
type mergeOutput struct {
	result   MergeResult
	merged   mergedReports
	shards   []shardRun
	coverage *Coverage
}

// writeMerged writes the merged reports, findings.jsonl, summary.txt and outcome.json.
func writeMerged(request MergeRequest, output mergeOutput) error {
	for _, edition := range output.merged.editions() {
		report := output.merged[edition]
		if err := WriteReport(filepath.Join(request.RunDir, "report", string(edition)), report.Rows, report.Meta); err != nil {
			return fmt.Errorf("write %s report: %w", edition, err)
		}
	}
	if err := concatFindings(request.RunDir, output.shards); err != nil {
		return err
	}
	summary := RenderSummary(SummaryInputs{
		BaseRef: request.BaseRef, CandidateRef: request.CandidateRef, Editions: output.merged.editions(),
		Rows: output.result.Rows, Coverage: output.coverage, Partial: append(output.result.Broken, output.result.Partial...),
	})
	if err := WriteSummaryFile(request.RunDir, summary); err != nil {
		return err
	}
	outcome := Outcome{RunDir: absolute(request.RunDir), Finished: true, Partial: output.result.Partial, Coverage: output.coverage}
	for _, shard := range output.shards {
		outcome.Routes += shard.outcome.Routes
		outcome.Flows += shard.outcome.Flows
	}
	return WriteOutcome(request.RunDir, outcome)
}

// concatFindings writes every shard's findings.jsonl, in shard order, as the merged one.
func concatFindings(runDir string, shards []shardRun) error {
	out, err := os.Create(filepath.Join(runDir, FindingsFile)) // #nosec G304 -- the merged run's own directory.
	if err != nil {
		return err
	}
	defer out.Close()
	for _, shard := range shards {
		in, err := os.Open(filepath.Join(shard.dir, FindingsFile)) // #nosec G304 -- the shard's own directory.
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		_, err = io.Copy(out, in)
		_ = in.Close()
		if err != nil {
			return err
		}
	}
	return out.Close()
}
