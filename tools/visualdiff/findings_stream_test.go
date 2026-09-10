package visualdiff

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// These cases bind the "A findings stream reports each comparison as it
// completes" rule in specs/tooling/visualdiff-on-haven.feature. Every one
// drives runWithFindings against a fake, swappable Deps.Capture that plays
// back a scripted sequence of OnCapture/OnDiff calls - the same seam
// RunRunner uses for real - so what is asserted is what a reader tailing
// findings.jsonl would actually see, line by line, without booting anything.

// memoryFindingsWriter is the in-memory FindingsWriter test double: every
// WriteLine call is recorded in order, immediately (there is nothing to
// flush), so a test can assert both content and order without touching disk.
type memoryFindingsWriter struct {
	lines []any
}

func (writer *memoryFindingsWriter) WriteLine(value any) error {
	writer.lines = append(writer.lines, value)
	return nil
}

// scriptedCapture builds a Deps.Capture fake that calls options.OnCapture and
// options.OnDiff in the given order before returning, exactly as RunRunner
// would as the runner subprocess streams its stdout - the "swappable
// runner" the spec calls for.
func scriptedCapture(captures []Capture, diffs []Diff) func(context.Context, RunnerPlan, CaptureOptions) (RunnerStream, error) {
	return func(_ context.Context, _ RunnerPlan, options CaptureOptions) (RunnerStream, error) {
		stream := RunnerStream{}
		for index := range captures {
			stream.Captures = append(stream.Captures, captures[index])
			if options.OnCapture != nil {
				options.OnCapture(captures[index])
			}
		}
		for index := range diffs {
			stream.Diffs = append(stream.Diffs, diffs[index])
			if options.OnDiff != nil {
				options.OnDiff(diffs[index])
			}
		}
		return stream, nil
	}
}

func fixedClock(at string) func() time.Time {
	parsed, err := time.Parse(time.RFC3339, at)
	if err != nil {
		panic(err)
	}
	return func() time.Time { return parsed }
}

func testDeps(capture func(context.Context, RunnerPlan, CaptureOptions) (RunnerStream, error), now func() time.Time) Deps {
	deps := Deps{Capture: capture, Now: now}
	deps.fill()
	return deps
}

// @scenario "Findings stream while the run is still going"
func TestFindingsStreamWhileTheRunIsStillGoing(t *testing.T) {
	t.Run("given a run capturing routes and flows on both stacks", func(t *testing.T) {
		captures := []Capture{
			{Kind: "route", Key: "/{slug}/analytics", Side: "base", Screenshot: "/run/base/routes/analytics.png"},
			{Kind: "route", Key: "/{slug}/analytics", Side: "candidate", Screenshot: "/run/candidate/routes/analytics.png"},
			{Kind: "route", Key: "/{slug}/settings", Side: "base", Screenshot: "/run/base/routes/settings.png"},
			{Kind: "route", Key: "/{slug}/settings", Side: "candidate", Screenshot: "/run/candidate/routes/settings.png", Error: "net::ERR_CONNECTION_REFUSED"},
		}
		diffs := []Diff{
			{Kind: "route", Key: "/{slug}/analytics", Ratio: 0.31, File: "/run/diff/analytics.png"},
		}
		writer := &memoryFindingsWriter{}
		modules := ModuleIndex{"analytics": "analytics"}
		tracker := newFindingsTracker(trackerInputs{Writer: writer, Modules: modules, RunRoot: "/run", Now: fixedClock("2026-09-10T03:00:00Z")})

		t.Run("when a screen's comparison is decided - a failed capture, a new console error, or a computed pixel diff", func(t *testing.T) {
			for _, capture := range captures {
				tracker.onCapture(capture)
			}
			for _, diff := range diffs {
				tracker.onDiff(diff)
			}

			t.Run("then one JSON line is appended straight away, per screen, not batched to the end", func(t *testing.T) {
				if len(writer.lines) != 2 {
					t.Fatalf("expected 2 findings written before finalize (settings' capture-failed fires on the candidate capture alone; analytics' changed fires on the diff), got %d: %+v", len(writer.lines), writer.lines)
				}
				settingsFailure, ok := writer.lines[0].(Finding)
				if !ok || settingsFailure.Kind != FindingCaptureFailed || settingsFailure.Route != "/{slug}/settings" {
					t.Fatalf("first finding = %+v, want the settings capture-failed", writer.lines[0])
				}
				if settingsFailure.Message != "candidate: net::ERR_CONNECTION_REFUSED" {
					t.Errorf("capture-failed message = %q", settingsFailure.Message)
				}
				analyticsChanged, ok := writer.lines[1].(Finding)
				if !ok || analyticsChanged.Kind != FindingChanged || analyticsChanged.Route != "/{slug}/analytics" {
					t.Fatalf("second finding = %+v, want the analytics changed", writer.lines[1])
				}
				if analyticsChanged.Module != "analytics" {
					t.Errorf("module = %q, want the guessed \"analytics\"", analyticsChanged.Module)
				}
				if analyticsChanged.Evidence.Base != filepath.Join("base", "routes", "analytics.png") {
					t.Errorf("evidence.base = %q, want a path relative to the run root", analyticsChanged.Evidence.Base)
				}
				if analyticsChanged.CapturedAt != "2026-09-10T03:00:00Z" {
					t.Errorf("capturedAt = %q", analyticsChanged.CapturedAt)
				}
			})

			t.Run("and the write is flushed before the run continues", func(t *testing.T) {
				// memoryFindingsWriter has nothing to buffer - every WriteLine
				// call already landed in writer.lines synchronously, which is
				// exactly the contract FindingsWriter promises callers. The
				// real file-backed writer's flush is proven in
				// TestFileFindingsWriterFlushesEachLineWithoutClosing.
				if len(writer.lines) == 0 {
					t.Fatal("nothing was written yet")
				}
			})

			t.Run("and once the capture stream ends, a base-only screen is missing-on-candidate and a run-complete line closes the file", func(t *testing.T) {
				tracker.onCapture(Capture{Kind: "route", Key: "/{slug}/traces", Side: "base", Screenshot: "/run/base/routes/traces.png"})

				if err := tracker.finalize(); err != nil {
					t.Fatalf("finalize: %v", err)
				}
				if len(writer.lines) != 4 {
					t.Fatalf("expected 2 more lines (missing-on-candidate, run-complete), got %d total: %+v", len(writer.lines), writer.lines)
				}
				missing, ok := writer.lines[2].(Finding)
				if !ok || missing.Kind != FindingMissingOnCandidate || missing.Route != "/{slug}/traces" {
					t.Fatalf("third finding = %+v, want traces missing-on-candidate", writer.lines[2])
				}
				complete, ok := writer.lines[3].(RunComplete)
				if !ok || complete.Kind != "run-complete" {
					t.Fatalf("last line = %+v, want run-complete", writer.lines[3])
				}
				if complete.Total != 3 {
					t.Errorf("run-complete total = %d, want 3", complete.Total)
				}
				if complete.Counts[FindingCaptureFailed] != 1 || complete.Counts[FindingChanged] != 1 || complete.Counts[FindingMissingOnCandidate] != 1 {
					t.Errorf("run-complete counts = %+v", complete.Counts)
				}
			})
		})
	})
}

// @scenario "Findings stream while the run is still going"
func TestRunWithFindingsWritesOneJSONLLinePerFindingToDisk(t *testing.T) {
	root := t.TempDir()
	writeCatalogue(t, root)
	runDir := t.TempDir()
	findingsPath := filepath.Join(runDir, FindingsFile)

	capture := scriptedCapture(
		[]Capture{
			{Kind: "route", Key: "/{slug}/analytics", Side: "base", Screenshot: filepath.Join(runDir, "base", "analytics.png")},
			{Kind: "route", Key: "/{slug}/analytics", Side: "candidate", Screenshot: filepath.Join(runDir, "candidate", "analytics.png")},
		},
		[]Diff{{Kind: "route", Key: "/{slug}/analytics", Ratio: 0.001, File: filepath.Join(runDir, "diff", "analytics.png")}},
	)
	deps := testDeps(capture, fixedClock("2026-09-10T03:05:00Z"))

	inputs := findingsRunInputs{Deps: deps, Plan: RunnerPlan{}, Options: CaptureOptions{}, FindingsPath: findingsPath, CatalogueRoot: root}
	if _, err := runWithFindings(context.Background(), inputs); err != nil {
		t.Fatalf("runWithFindings: %v", err)
	}

	raw, err := os.ReadFile(findingsPath)
	if err != nil {
		t.Fatalf("read findings file: %v", err)
	}
	lines := splitNonEmptyLines(string(raw))
	if len(lines) != 2 {
		t.Fatalf("expected 1 finding + 1 run-complete line, got %d:\n%s", len(lines), raw)
	}
	var finding Finding
	if err := json.Unmarshal([]byte(lines[0]), &finding); err != nil {
		t.Fatalf("unmarshal finding line: %v", err)
	}
	if finding.Kind != FindingIdentical || finding.Module != "analytics" {
		t.Errorf("finding = %+v", finding)
	}
	var complete RunComplete
	if err := json.Unmarshal([]byte(lines[1]), &complete); err != nil {
		t.Fatalf("unmarshal run-complete line: %v", err)
	}
	if complete.Kind != "run-complete" || complete.Total != 1 {
		t.Errorf("run-complete = %+v", complete)
	}
}

// @scenario "Findings stream while the run is still going"
func TestFileFindingsWriterFlushesEachLineWithoutClosing(t *testing.T) {
	path := filepath.Join(t.TempDir(), FindingsFile)
	writer, err := OpenFindingsFile(path)
	if err != nil {
		t.Fatalf("OpenFindingsFile: %v", err)
	}
	defer writer.Close()

	if err := writer.WriteLine(Finding{Kind: FindingChanged, Route: "/a"}); err != nil {
		t.Fatalf("WriteLine: %v", err)
	}
	// Read the file back WITHOUT closing the writer - a `tail -f` reader
	// would do exactly this while the run is still going. If WriteLine
	// buffered instead of flushing, this read would see nothing yet.
	firstRead, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read after first write: %v", err)
	}
	if len(splitNonEmptyLines(string(firstRead))) != 1 {
		t.Fatalf("expected the first line to be visible before the writer closes, got:\n%s", firstRead)
	}

	if err := writer.WriteLine(Finding{Kind: FindingIdentical, Route: "/b"}); err != nil {
		t.Fatalf("WriteLine: %v", err)
	}
	secondRead, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read after second write: %v", err)
	}
	if len(splitNonEmptyLines(string(secondRead))) != 2 {
		t.Fatalf("expected both lines visible before the writer closes, got:\n%s", secondRead)
	}
}

func splitNonEmptyLines(text string) []string {
	var lines []string
	start := 0
	for index := 0; index < len(text); index++ {
		if text[index] == '\n' {
			if line := text[start:index]; line != "" {
				lines = append(lines, line)
			}
			start = index + 1
		}
	}
	if start < len(text) {
		if line := text[start:]; line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}
