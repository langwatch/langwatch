package visualdiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeShard lays out one shard's downloaded run directory as CI does.
func writeShard(t *testing.T, dir string, outcome Outcome, rows []Row) {
	t.Helper()
	if err := WriteOutcome(dir, outcome); err != nil {
		t.Fatal(err)
	}
	if rows != nil {
		if err := WriteReport(filepath.Join(dir, "report", "enterprise"), rows, ReportMeta{BaseRef: "origin/main", CandidateRef: "HEAD"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, FindingsFile), []byte(`{"route":"`+filepath.Base(dir)+`"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func shotRow(key, runDir string, class Classification) Row {
	shot := filepath.Join(runDir, "shots", "enterprise", key+".png")
	return Row{
		Edition: EditionEnterprise, Kind: "route", Key: key, Class: class,
		Base: &Capture{Side: "base", Screenshot: shot}, Candidate: &Capture{Side: "candidate", Screenshot: shot},
	}
}

// @scenario "Merging shards produces one report, and a missing shard makes it partial"
func TestMergeCombinesShardsAndRebasesTheirScreens(t *testing.T) {
	runDir := t.TempDir()
	original := "/home/runner/work/_temp/visualdiff-run"
	one, two := filepath.Join(runDir, ShardsDir, "visualdiff-shard-1"), filepath.Join(runDir, ShardsDir, "visualdiff-shard-2")
	coverage := &Coverage{Entries: []CoverageEntry{{Pattern: "/gone", Status: CoverageUncovered}}}
	writeShard(t, one, Outcome{RunDir: original, Shard: "1/2", Finished: true, Coverage: coverage}, []Row{shotRow("a", original, ClassNoise)})
	writeShard(t, two, Outcome{RunDir: original, Shard: "2/2", Finished: true}, []Row{shotRow("b", original, ClassRegression)})

	result, err := Merge(MergeRequest{RunDir: runDir, Shards: 2, BaseRef: "origin/main", CandidateRef: "HEAD"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rows) != 2 || result.Rows[0].Key != "b" || len(result.Partial) != 0 {
		t.Fatalf("merged rows %+v, partial %v", result.Rows, result.Partial)
	}
	if result.Findings != 2 || result.ExitCode() != ExitFindings {
		t.Fatalf("findings %d (the regression and the uncovered route), exit %d", result.Findings, result.ExitCode())
	}
	if want := filepath.Join(two, "shots", "enterprise", "b.png"); result.Rows[0].Candidate.Screenshot != want {
		t.Fatalf("screenshot %s, want it rebased to %s", result.Rows[0].Candidate.Screenshot, want)
	}
	rows, err := ReadReportRows(runDir)
	if err != nil || len(rows) != 2 {
		t.Fatalf("publish reads %d merged rows, %v", len(rows), err)
	}
	findings, _ := os.ReadFile(filepath.Join(runDir, FindingsFile))
	if strings.Count(string(findings), "\n") != 2 {
		t.Fatalf("findings.jsonl is not both shards': %q", findings)
	}
}

// @scenario "Merging shards produces one report, and a missing shard makes it partial"
func TestMergeOfACutShortShardIsPartial(t *testing.T) {
	runDir := t.TempDir()
	writeShard(t, filepath.Join(runDir, ShardsDir, "s1"), Outcome{RunDir: "/r", Finished: true, Partial: []string{DeadlineReason}}, []Row{shotRow("a", "/r", ClassNoise)})
	writeShard(t, filepath.Join(runDir, ShardsDir, "s2"), Outcome{RunDir: "/r"}, nil)
	if err := os.WriteFile(filepath.Join(runDir, ShardsDir, "s2", ExitCodeFile), []byte("124\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := Merge(MergeRequest{RunDir: runDir, Shards: 3, BaseRef: "origin/main", CandidateRef: "HEAD"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Partial) != 3 || result.ExitCode() != ExitClean {
		t.Fatalf("partial %v, exit %d: want the deadline, the shard with no report and the missing shard, and still a publishable exit", result.Partial, result.ExitCode())
	}
	summary, _ := os.ReadFile(filepath.Join(runDir, SummaryFile))
	if !strings.Contains(string(summary), "PARTIAL RUN") || !strings.Contains(string(summary), "s2 left no report (exit 124)") {
		t.Fatalf("summary does not say the run is partial:\n%s", summary)
	}
	outcome, found, err := ReadOutcome(runDir)
	if err != nil || !found || len(outcome.Partial) != 3 {
		t.Fatalf("merged outcome %+v, %v, %v: publish reads partial from it", outcome, found, err)
	}
}

func TestMergeWithABrokenShardExitsOperational(t *testing.T) {
	runDir := t.TempDir()
	dir := filepath.Join(runDir, ShardsDir, "s1")
	writeShard(t, dir, Outcome{RunDir: "/r", Finished: true}, []Row{shotRow("a", "/r", ClassNoise)})
	if err := os.WriteFile(filepath.Join(dir, ExitCodeFile), []byte("2"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := Merge(MergeRequest{RunDir: runDir, Shards: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode() != ExitOperational || len(result.Broken) != 1 {
		t.Fatalf("exit %d, broken %v", result.ExitCode(), result.Broken)
	}
}

func TestPartialRunSaysSoInTheComment(t *testing.T) {
	body, _ := RenderComment(PublishHeadline{Partial: []string{"shard 3 left no report"}}, nil)
	if !strings.Contains(body, "Partial run") || !strings.Contains(body, "shard 3 left no report") {
		t.Fatalf("comment does not say the run was partial:\n%s", body)
	}
}
