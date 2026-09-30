package visualdiff

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// These bind the "Review batches seal while the run is still going" rule in
// specs/tooling/visualdiff-triage.feature: item completions are played into the
// batcher's hooks as RunRunner would, and the batch directories are read back.

func batchFixture(t *testing.T) (string, *batcher, *strings.Builder) {
	t.Helper()
	dir := t.TempDir()
	out := &strings.Builder{}
	plan := RunnerPlan{
		Check: true, Edition: EditionEnterprise,
		Sides: []RunnerSide{{Name: "base", Replay: filepath.Join(dir, "captures.jsonl")}, {Name: "candidate"}},
	}
	now := func() time.Time { return time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC) }
	return dir, newBatcher(batcherInputs{OutDir: dir, Size: 2, Plan: plan, Out: out, Now: now}), out
}

func shot(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, "shots", name+".png")
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func routeCapture(t *testing.T, dir, side, route string) Capture {
	t.Helper()
	return Capture{Kind: "route", Key: route, Side: side, URL: "https://app" + route, Screenshot: shot(t, dir, side+strings.ReplaceAll(route, "/", "_"))}
}

func readBatch(t *testing.T, dir string) Batch {
	t.Helper()
	encoded, err := os.ReadFile(filepath.Join(dir, BatchFile))
	if err != nil {
		t.Fatal(err)
	}
	batch := Batch{}
	if err := json.Unmarshal(encoded, &batch); err != nil {
		t.Fatal(err)
	}
	return batch
}

func assertSealed(t *testing.T, dir string) {
	t.Helper()
	for _, name := range []string{BatchFile, BatchReviewFile, BatchReadyFile} {
		if !fileExists(filepath.Join(dir, name)) {
			t.Fatalf("%s: %s missing", dir, name)
		}
	}
	if fileExists(filepath.Join(dir, BatchReadyFile+".tmp")) {
		t.Fatalf("%s: READY's staging file left behind", dir)
	}
}

// @scenario "A batch seals every N completed items, and at each phase boundary"
func TestBatcherSealsEveryNItemsAndAtPhaseBoundaries(t *testing.T) {
	dir, batches, out := batchFixture(t)
	batches.onCapture(routeCapture(t, dir, "base", "/a"))
	batches.onCapture(routeCapture(t, dir, "base", "/b"))
	batches.onCapture(routeCapture(t, dir, "candidate", "/a"))
	batches.onDiff(Diff{Kind: "route", Key: "/a", Ratio: 0, File: shot(t, dir, "diff_a")})
	batches.onCapture(routeCapture(t, dir, "candidate", "/b"))
	if len(readyBatches(filepath.Join(dir, BatchesDir), 0)) != 0 {
		t.Fatal("a route waiting on its pixel diff must not seal")
	}
	batches.onDiff(Diff{Kind: "route", Key: "/b", Ratio: 0.5, File: shot(t, dir, "diff_b")})

	first := filepath.Join(dir, BatchesDir, "0001-routes")
	assertSealed(t, first)
	batch := readBatch(t, first)
	if len(batch.Items) != 2 || batch.Flagged != 1 || batch.Items[0].Verdict != "pass" || batch.Items[1].Verdict != "fail" {
		t.Fatalf("first batch = %+v", batch)
	}
	candidate := batch.Items[1].Screens[0].Candidate
	if candidate == nil || candidate.URL != "https://app/b" || !fileExists(filepath.Join(first, candidate.Screenshot)) {
		t.Fatalf("candidate evidence not in the batch: %+v", candidate)
	}
	if !fileExists(filepath.Join(first, batch.Items[1].Screens[0].Diff)) {
		t.Fatal("diff image not in the batch")
	}

	batches.onCapture(routeCapture(t, dir, "candidate", "/c"))
	batches.onPhase(RunnerPhase{Side: "candidate", Name: "capture"})
	second := filepath.Join(dir, BatchesDir, "0002-routes")
	assertSealed(t, second)
	if batch := readBatch(t, second); len(batch.Items) != 1 || batch.Flagged != 0 {
		t.Fatalf("the phase boundary seals the one ready route, unflagged with nothing of main's: %+v", batch)
	}

	batches.onCapture(Capture{Kind: "flow", Key: "f1", Side: "candidate", Index: 0, Expect: "held"})
	batches.onCapture(Capture{Kind: "flow", Key: "f1", Side: "candidate", Index: 1})
	batches.onCapture(Capture{Kind: "flow", Key: "f2", Side: "candidate", Index: 0, Label: "save", Error: "timeout"})
	batches.onPhase(RunnerPhase{Side: "candidate", Name: "flow f2"})
	third := readBatch(t, filepath.Join(dir, BatchesDir, "0003-flows"))
	if third.Items[0].Verdict != "pass" || third.Items[1].Verdict != "fail" || third.Items[1].Failing == nil || third.Items[1].Failing.Label != "save" {
		t.Fatalf("flows keep check's verdicts: %+v", third.Items)
	}

	batches.onCapture(Capture{Kind: "flow", Key: "f3", Side: "candidate"})
	if err := batches.close(); err != nil {
		t.Fatal(err)
	}
	fourth := filepath.Join(dir, BatchesDir, "0004-flows")
	assertSealed(t, fourth)
	if batch := readBatch(t, fourth); batch.Items[0].Verdict != "unproven" || !batch.Items[0].Flagged {
		t.Fatalf("the run's end flushes the open flow: %+v", batch)
	}

	lines := readIndex(t, filepath.Join(dir, BatchesIndex))
	if len(lines) != 4 || lines[0].Dir != first || lines[0].Flagged != 1 || lines[3].Phase != "flows" {
		t.Fatalf("batches.jsonl = %+v", lines)
	}
	if !strings.Contains(out.String(), "visualdiff: batch 0001 ready (2 items, 1 flagged) "+first+"\n") {
		t.Fatalf("stdout = %q", out.String())
	}
	if review, _ := os.ReadFile(filepath.Join(first, BatchReviewFile)); !strings.Contains(string(review), "## Known noise") {
		t.Fatalf("REVIEW.md = %s", review)
	}
}

func readIndex(t *testing.T, path string) []BatchIndexLine {
	t.Helper()
	file, err := os.Open(path) // #nosec G304 -- the test's own temp file.
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	var lines []BatchIndexLine
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := BatchIndexLine{}
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, line)
	}
	return lines
}

// @scenario "A reviewer waits for the next ready batch and never reads a half-written one"
func TestWaitForBatchSkipsUnreadyAndReviewedBatches(t *testing.T) {
	root := filepath.Join(t.TempDir(), BatchesDir)
	for _, name := range []string{"0001-routes", "0002-flows"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0o750); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "0001-routes", BatchReadyFile), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if path, err := waitForBatch(ctx, root, 1, 5*time.Millisecond); err == nil {
		t.Fatalf("0002 has no READY, yet %s was answered", path)
	}
	if err := os.WriteFile(filepath.Join(root, "0002-flows", BatchReadyFile), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	path, err := waitForBatch(context.Background(), root, 1, 5*time.Millisecond)
	if err != nil || path != filepath.Join(root, "0002-flows") {
		t.Fatalf("wait = %s, %v", path, err)
	}
}

// @scenario "A batch seals every N completed items, and at each phase boundary"
func TestBatchSizeZeroTurnsBatchingOff(t *testing.T) {
	batches := newBatcher(batcherInputs{OutDir: t.TempDir()})
	options := batches.wrap(CaptureOptions{})
	if batches != nil || options.OnCapture != nil || batches.close() != nil {
		t.Fatal("-batch-size 0 must leave the capture untouched")
	}
}

// @scenario "A reviewer waits for the next ready batch and never reads a half-written one"
func TestBatchReviewRefusesABatchWithoutReady(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, BatchReviewFile), []byte("# brief\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	out, errs := &strings.Builder{}, &strings.Builder{}
	if code := batchReviewCommand([]string{dir}, Streams{Out: out, Err: errs}); code != ExitOperational || out.Len() != 0 {
		t.Fatalf("unready batch: exit %d, out %q", code, out.String())
	}
	if err := os.WriteFile(filepath.Join(dir, BatchReadyFile), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if code := batchReviewCommand([]string{dir}, Streams{Out: out, Err: errs}); code != ExitClean || out.String() != "# brief\n" {
		t.Fatalf("ready batch: exit %d, out %q", code, out.String())
	}
}
