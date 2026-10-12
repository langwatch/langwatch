package visualdiff

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writeRunReport writes report/enterprise/findings.json for a finished run,
// with one screenshot per side on disk.
func writeRunReport(t *testing.T, root string, class Classification) {
	t.Helper()
	runDir := filepath.Join(root, ".visualdiff", "run-1")
	shot := filepath.Join(runDir, "shots", "enterprise", "settings.png")
	if err := os.MkdirAll(filepath.Dir(shot), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(shot, []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	rows := []Row{{
		Kind: "route", Key: "/settings", Class: class,
		Base:      &Capture{Screenshot: shot, AriaSnapshot: "- heading \"Settings\""},
		Candidate: &Capture{Screenshot: shot, ConsoleErrors: []string{"warn"}},
	}}
	meta := ReportMeta{BaseCommit: strings.Repeat("a", 40), CandidateCommit: strings.Repeat("b", 40)}
	if err := WriteReport(filepath.Join(runDir, "report", "enterprise"), rows, meta); err != nil {
		t.Fatal(err)
	}
}

func doneRequestFor(root string) DoneRequest {
	return DoneRequest{
		Root: root, RunID: "run-1", Edition: EditionEnterprise, Kind: "route", Section: "/settings",
		Note: "copy only", Now: time.Unix(0, 0),
	}
}

// @scenario "A section marked done keeps its proof and is skipped by later runs"
func TestMarkDoneKeepsTheSectionsProof(t *testing.T) {
	root := t.TempDir()
	writeRunReport(t, root, ClassCopy)

	entry, err := MarkDone(doneRequestFor(root))
	if err != nil {
		t.Fatal(err)
	}

	dir := filepath.Join(root, ".visualdiff", DoneDir, "enterprise", "route-%2Fsettings")
	for _, name := range []string{"00-base.png", "00-candidate.png", "rows.json", BaselineMetaFile} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("proof %s: %v", name, err)
		}
	}
	rows, _ := os.ReadFile(filepath.Join(dir, "rows.json"))
	if !strings.Contains(string(rows), "heading") || !strings.Contains(string(rows), "warn") {
		t.Fatalf("rows.json must keep the aria snapshots and console log: %s", rows)
	}
	ledger, err := LoadDoneLedger(root)
	if err != nil || len(ledger) != 1 || ledger[0].CandidateCommit != entry.CandidateCommit || ledger[0].Note != "copy only" {
		t.Fatalf("ledger: %+v %v", ledger, err)
	}
}

// @scenario "A section with a failing class is refused unless forced"
func TestMarkDoneRefusesAFailingSection(t *testing.T) {
	root := t.TempDir()
	writeRunReport(t, root, ClassRegression)

	if _, err := MarkDone(doneRequestFor(root)); err == nil || !strings.Contains(err.Error(), "regression") {
		t.Fatalf("a regression must be refused: %v", err)
	}
	if ledger, _ := LoadDoneLedger(root); len(ledger) != 0 {
		t.Fatalf("a refused section must leave no entry: %+v", ledger)
	}
	forced := doneRequestFor(root)
	forced.Force = true
	if entry, err := MarkDone(forced); err != nil || !entry.Forced {
		t.Fatalf("-force with a note marks it done: %+v %v", entry, err)
	}
	forced.Note = ""
	if _, err := MarkDone(forced); err == nil {
		t.Fatal("a note is always required")
	}
}

func TestMarkDoneRefusesASectionTheRunNeverCaptured(t *testing.T) {
	root := t.TempDir()
	writeRunReport(t, root, ClassNoise)
	request := doneRequestFor(root)
	request.Section = "/elsewhere"

	if _, err := MarkDone(request); err == nil {
		t.Fatal("a section the run never captured must be refused")
	}
}

func TestUndoRemovesAnEntryAndListShowsTheRest(t *testing.T) {
	root := t.TempDir()
	writeRunReport(t, root, ClassNoise)
	if _, err := MarkDone(doneRequestFor(root)); err != nil {
		t.Fatal(err)
	}
	ledger, _ := LoadDoneLedger(root)
	var listed bytes.Buffer
	WriteDoneList(&listed, ledger)
	if !strings.HasPrefix(listed.String(), "enterprise/route-%2Fsettings  bbbbbbbbbbbb  1970-01-01  copy only") {
		t.Fatalf("list: %q", listed.String())
	}

	if err := UndoDone(root, "../escape"); err == nil {
		t.Fatal("a key outside the ledger must be refused")
	}
	if err := UndoDone(root, "enterprise/route-%2Fsettings"); err != nil {
		t.Fatal(err)
	}
	if ledger, _ := LoadDoneLedger(root); len(ledger) != 0 {
		t.Fatalf("undo leaves: %+v", ledger)
	}
}

// @scenario "A section marked done keeps its proof and is skipped by later runs"
func TestARunSkipsDoneSectionsAndNeverCallsThemUncovered(t *testing.T) {
	var handed RunnerPlan
	deps := passingDeps(&fakeRunner{}, nil, nil)
	deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
		handed = plan
		return RunnerStream{}, nil
	}
	done := DoneLedger{
		{Edition: EditionEnterprise, Kind: "route", Section: "/settings"},
		{Edition: EditionEnterprise, Kind: "flow", Section: "annotate"},
		{Edition: EditionFree, Kind: "route", Section: "/{slug}/traces"},
	}
	config := testConfig()
	stderr := &bytes.Buffer{}

	result, err := Execute(context.Background(), Request{Options: testOptions(t), Config: config, Deps: deps, Done: done}, Streams{Out: &bytes.Buffer{}, Err: stderr})
	if err != nil {
		t.Fatal(err)
	}

	if len(handed.Routes) != 1 || handed.Routes[0] != "/{slug}/traces" || len(handed.Flows) != 1 || handed.Flows[0].ID != "prompt-create" {
		t.Fatalf("only the sections not done reach the runner: %+v %+v", handed.Routes, handed.Flows)
	}
	if !strings.Contains(stderr.String(), "skipped 2") || !strings.Contains(stderr.String(), "enterprise/flow-annotate") {
		t.Fatalf("the run must say what it skipped: %s", stderr.String())
	}
	if len(config.Routes) != 2 || result.Findings != 0 {
		t.Fatalf("the configured routes stay whole and a skip is no finding: %+v %d", config.Routes, result.Findings)
	}
}

func TestADryRunPrintsTheSkipLine(t *testing.T) {
	options := testOptions(t)
	options.DryRun = true
	stdout := &bytes.Buffer{}
	done := DoneLedger{{Edition: EditionEnterprise, Kind: "route", Section: "/settings"}}

	if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: passingDeps(&fakeRunner{}, nil, nil), Done: done}, Streams{Out: stdout, Err: &bytes.Buffer{}}); err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(stdout.String(), "done      skipped 1 (-include-done captures them): enterprise/route-%2Fsettings") {
		t.Fatalf("dry run: %s", stdout.String())
	}
}
