package visualdiff

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// FindingsFile is the run-scoped findings stream both `run` and any
// `recapture` against it append to, in the run directory alongside
// findings.json/findings.md/report.html.
const FindingsFile = "findings.jsonl"

// Finding is one line of a run's findings.jsonl - one screen's comparison,
// written the instant enough is known to classify it.
type Finding struct {
	Edition    Edition         `json:"edition,omitempty"`
	Route      string          `json:"route,omitempty"`
	Flow       string          `json:"flow,omitempty"`
	Index      int             `json:"index,omitempty"`
	Kind       Classification  `json:"kind"`
	Finding    bool            `json:"finding"`
	Module     string          `json:"module"`
	Evidence   FindingEvidence `json:"evidence"`
	Message    string          `json:"message"`
	CapturedAt string          `json:"capturedAt"`
}

// FindingEvidence names this finding's images, relative to the run root so
// the run directory stays self-contained.
type FindingEvidence struct {
	Base      string `json:"base,omitempty"`
	Candidate string `json:"candidate,omitempty"`
	Diff      string `json:"diff,omitempty"`
	// URL is where the candidate ended; Requests its new failed API calls;
	// Controls the role diff - the text an agent triages from without the images.
	URL      string   `json:"url,omitempty"`
	Requests []string `json:"requests,omitempty"`
	Controls string   `json:"controls,omitempty"`
}

// RunComplete is the findings stream's last line: how many of each kind, so
// a reader tailing the file knows the run finished and what it added up to.
type RunComplete struct {
	Kind       string         `json:"kind"`
	Edition    Edition        `json:"edition,omitempty"`
	Total      int            `json:"total"`
	Counts     map[string]int `json:"counts"`
	CapturedAt string         `json:"capturedAt"`
}

// FindingsWriter appends one JSON-encoded value as a line. An implementation
// must flush before it returns, so a reader tailing the file sees every
// finding as it lands, not only once the run ends.
type FindingsWriter interface {
	WriteLine(value any) error
}

// fileFindingsWriter appends JSON lines to findings.jsonl, fsyncing after
// each write so `tail -f` sees every finding as soon as it is decided.
type fileFindingsWriter struct {
	file *os.File
}

// OpenFindingsFile opens (creating if needed) the findings file at path for
// appending. Both a fresh run and a later recapture use it: a recapture's
// findings land after whatever the run already wrote, in the same file.
func OpenFindingsFile(path string) (*fileFindingsWriter, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600) // #nosec G304 -- path is this run's own <rundir>/findings.jsonl.
	if err != nil {
		return nil, err
	}
	return &fileFindingsWriter{file: file}, nil
}

// WriteLine marshals value as one JSON line and fsyncs before returning.
func (writer *fileFindingsWriter) WriteLine(value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	if _, err := writer.file.Write(encoded); err != nil {
		return err
	}
	return writer.file.Sync()
}

// Close closes the underlying file.
func (writer *fileFindingsWriter) Close() error {
	return writer.file.Close()
}

// findingsRunInputs groups runWithFindings' arguments so the function itself
// stays within this repository's argument-count limit.
type findingsRunInputs struct {
	Deps    Deps
	Plan    RunnerPlan
	Options CaptureOptions
	// FindingsPath is the findings.jsonl this run (or recapture) appends to.
	FindingsPath string
	// CatalogueRoot is the repository root CatalogueFile is read relative to
	// - always the developer's own checkout, never a worktree, since the
	// module guess is the same regardless of which ref is being compared.
	CatalogueRoot string
	// Edition tags every line this pass writes, so one findings.jsonl carries
	// every edition's pass side by side.
	Edition Edition
}

// runWithFindings drives inputs.Deps.Capture, writing one Finding to
// inputs.FindingsPath per screen the instant its comparison is decided, and
// a final run-complete summary once the stream ends. Append mode throughout,
// so a recapture's findings land after whatever the run already wrote.
func runWithFindings(ctx context.Context, inputs findingsRunInputs) (RunnerStream, error) {
	writer, err := OpenFindingsFile(inputs.FindingsPath)
	if err != nil {
		return RunnerStream{}, fmt.Errorf("open findings file: %w", err)
	}
	defer writer.Close()
	modules, err := LoadModuleIndex(inputs.CatalogueRoot)
	if err != nil {
		modules = ModuleIndex{}
	}
	tracker := newFindingsTracker(trackerInputs{
		Writer: writer, Modules: modules, RunRoot: filepath.Dir(inputs.FindingsPath), Now: inputs.Deps.Now,
		Edition: inputs.Edition,
	})
	options := inputs.Options
	options.OnCapture = tracker.onCapture
	options.OnDiff = tracker.onDiff
	stream, captureErr := inputs.Deps.Capture(ctx, inputs.Plan, options)
	if err := tracker.finalize(); err != nil && captureErr == nil {
		captureErr = fmt.Errorf("write findings: %w", err)
	}
	return stream, captureErr
}

// findingsTracker classifies capture/diff events into Findings as they
// stream in, and writes each one the instant it is decided.
type findingsTracker struct {
	edition Edition
	writer  FindingsWriter
	modules ModuleIndex
	runRoot string
	now     func() time.Time
	rows    map[rowKey]*trackedRow
	order   []rowKey
	counts  map[string]int
	err     error
}

// trackedRow is one screen's comparison in progress: what has arrived for it
// so far, across however many capture/diff events named it.
type trackedRow struct {
	kind, key       string
	index           int
	base, candidate *Capture
	diff            *Diff
	written         bool
}

// trackerInputs groups newFindingsTracker's arguments so the function itself
// stays within this repository's argument-count limit.
type trackerInputs struct {
	Writer  FindingsWriter
	Modules ModuleIndex
	RunRoot string
	Now     func() time.Time
	Edition Edition
}

func newFindingsTracker(inputs trackerInputs) *findingsTracker {
	return &findingsTracker{
		edition: inputs.Edition,
		writer:  inputs.Writer, modules: inputs.Modules, runRoot: inputs.RunRoot, now: inputs.Now,
		rows: map[rowKey]*trackedRow{}, counts: map[string]int{},
	}
}

func (tracker *findingsTracker) row(kind, key string, index int) *trackedRow {
	identity := rowKey{kind, key, index}
	row, ok := tracker.rows[identity]
	if !ok {
		row = &trackedRow{kind: kind, key: key, index: index}
		tracker.rows[identity] = row
		tracker.order = append(tracker.order, identity)
	}
	return row
}

func (tracker *findingsTracker) onCapture(capture Capture) {
	row := tracker.row(capture.Kind, capture.Key, capture.Index)
	captured := capture
	if capture.Side == "base" {
		row.base = &captured
	} else {
		row.candidate = &captured
	}
	tracker.tryEmit(row)
}

func (tracker *findingsTracker) onDiff(diff Diff) {
	row := tracker.row(diff.Kind, diff.Key, diff.Index)
	computed := diff
	row.diff = &computed
	tracker.tryEmit(row)
}

// tryEmit writes a Finding for row the instant Classify can decide it, and
// never twice: once both captures are in, and also the pixel diff when the
// verdict turns on it. A capture that never arrives is decided in finalize,
// since mid-run it cannot be told apart from one still coming.
func (tracker *findingsTracker) tryEmit(row *trackedRow) {
	if row.written || row.base == nil || row.candidate == nil {
		return
	}
	verdict := row.toRow()
	class, why := Classify(verdict)
	if NeedsPixels(class) && row.diff == nil {
		return
	}
	tracker.emit(row, class, why)
}

// toRow is the tracked screen in the shape Classify reads.
func (row *trackedRow) toRow() Row {
	verdict := Row{Kind: row.kind, Key: row.key, Index: row.index, Base: row.base, Candidate: row.candidate}
	if row.diff != nil {
		verdict.Ratio, verdict.Diffed, verdict.DiffFile = row.diff.Ratio, true, row.diff.File
	}
	return verdict
}

func (tracker *findingsTracker) emit(row *trackedRow, kind Classification, message string) {
	row.written = true
	tracker.counts[string(kind)]++
	tracker.write(tracker.toFinding(row, kind, message))
}

func (tracker *findingsTracker) toFinding(row *trackedRow, kind Classification, message string) Finding {
	finding := Finding{
		Edition: tracker.edition, Finding: kind.IsFinding(),
		Kind: kind, Module: tracker.modules.lookup(moduleKey(row.key)),
		Message: message, CapturedAt: tracker.now().Format(time.RFC3339),
		Evidence: FindingEvidence{
			Base:      tracker.relative(captureScreenshot(row.base)),
			Candidate: tracker.relative(captureScreenshot(row.candidate)),
			Diff:      tracker.relative(diffFile(row.diff)),
		},
	}
	if row.candidate != nil {
		finding.Evidence.URL = row.candidate.URL
		finding.Evidence.Requests = NewAPIFailures(baseRequests(row.base), row.candidate.FailedRequests)
		finding.Evidence.Controls = CompareText(baseSnapshot(row.base), row.candidate.AriaSnapshot).Summary()
	}
	if row.kind == "flow" {
		finding.Flow = row.key
		finding.Index = row.index
	} else {
		finding.Route = row.key
	}
	return finding
}

func (tracker *findingsTracker) relative(path string) string {
	if path == "" || tracker.runRoot == "" {
		return path
	}
	rel, err := filepath.Rel(tracker.runRoot, path)
	if err != nil {
		return path
	}
	return rel
}

func (tracker *findingsTracker) write(finding Finding) {
	if err := tracker.writer.WriteLine(finding); err != nil && tracker.err == nil {
		tracker.err = err
	}
}

// finalize runs once the capture stream ends and decides every screen still
// open: a side that never arrived, or a diff that never came. Then it writes
// the run-complete summary line.
func (tracker *findingsTracker) finalize() error {
	for _, identity := range tracker.order {
		row := tracker.rows[identity]
		if row.written {
			continue
		}
		class, why := Classify(row.toRow())
		tracker.emit(row, class, why)
	}
	total := 0
	counts := map[string]int{}
	for kind, count := range tracker.counts {
		counts[kind] = count
		total += count
	}
	if err := tracker.writer.WriteLine(RunComplete{Kind: "run-complete", Edition: tracker.edition, Total: total, Counts: counts, CapturedAt: tracker.now().Format(time.RFC3339)}); err != nil && tracker.err == nil {
		tracker.err = err
	}
	return tracker.err
}

func baseRequests(capture *Capture) []string {
	if capture == nil {
		return nil
	}
	return capture.FailedRequests
}

func baseSnapshot(capture *Capture) string {
	if capture == nil {
		return ""
	}
	return capture.AriaSnapshot
}

func captureScreenshot(capture *Capture) string {
	if capture == nil {
		return ""
	}
	return capture.Screenshot
}

func diffFile(diff *Diff) string {
	if diff == nil {
		return ""
	}
	return diff.File
}
