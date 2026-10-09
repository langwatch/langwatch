package visualdiff

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeJudgeLedger(t *testing.T, runDir string, edition Edition, body string) {
	t.Helper()
	dir := filepath.Join(runDir, "shots", string(edition))
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, JudgeFile), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readVerdict(t *testing.T, runDir string, rows []Row) string {
	t.Helper()
	if err := WriteVerdictFile(runDir, rows, nil); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(runDir, VerdictFile))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// @scenario "The judge flag gives the runner a cache that outlives the run"
func TestTheJudgeFlagSetsALastingCacheFile(t *testing.T) {
	if judge := judgeFor(Options{Root: "/repo"}); judge != nil {
		t.Fatalf("a run without -judge asks no judge: %+v", judge)
	}
	judge := judgeFor(Options{Root: "/repo", Judge: true})
	if judge == nil || judge.CacheFile != "/repo/.visualdiff/judge-cache.json" {
		t.Fatalf("judge: %+v", judge)
	}
}

// @scenario "An agreed regression fails the pair in the verdict"
func TestAnAgreedRegressionFailsTheScreen(t *testing.T) {
	runDir := t.TempDir()
	writeJudgeLedger(t, runDir, EditionEnterprise, `{"model":"claude-haiku-5-5","calls":2,"inputTokens":3000,"outputTokens":120,
		"usd":0.00036,"cached":0,"failures":0,"firstFailure":"",
		"pairs":[{"label":"route-3","cached":false,"regressions":[{"kind":"missing-element","element":"Save button","message":"gone on the branch"}]}]}`)
	rows := []Row{{Edition: EditionEnterprise, Kind: "route", Key: "/a", Class: ClassLayout, Why: "moved", DiffFile: "/run/diff/route-3.png"}}

	verdict := readVerdict(t, runDir, rows)

	for _, want := range []string{
		"/a: regression · judge: missing-element Save button: gone on the branch",
		"[enterprise] claude-haiku-5-5: 1 pairs (0 cached), 2 calls, 3000 in / 120 out tokens, $0.0004",
	} {
		if !strings.Contains(verdict, want) {
			t.Fatalf("verdict lacks %q:\n%s", want, verdict)
		}
	}
	if rows[0].Class != ClassLayout {
		t.Fatalf("the caller's rows are not changed: %+v", rows[0])
	}
}

// @scenario "A judged pair with no regression is marked judged-harmless"
func TestAJudgedPairWithNoRegressionIsHarmless(t *testing.T) {
	runDir := t.TempDir()
	writeJudgeLedger(t, runDir, EditionEnterprise, `{"model":"m","pairs":[{"label":"route-3","cached":true,"regressions":[]}]}`)
	rows := []Row{{Edition: EditionEnterprise, Kind: "route", Key: "/a", Class: ClassLayout, Why: "moved", DiffFile: "/run/diff/route-3.png"}}

	verdict := readVerdict(t, runDir, rows)

	if !strings.Contains(verdict, "/a: layout · moved · judged-harmless") {
		t.Fatalf("verdict:\n%s", verdict)
	}
}

// @scenario "A judged regression is counted in the summary, works.json and verdict.md alike"
func TestAJudgedRegressionChangesTheSummaryCount(t *testing.T) {
	runDir, root := t.TempDir(), t.TempDir()
	writeJudgeLedger(t, runDir, EditionEnterprise, `{"model":"m","pairs":[{"label":"route-3","regressions":[{"kind":"missing-element","element":"Save button","message":"gone"}]}]}`)
	rows := []Row{{Edition: EditionEnterprise, Kind: "route", Key: "/a", Class: ClassNoise, DiffFile: "/run/diff/route-3.png"}}
	run := &session{
		request: Request{Options: Options{Root: root, RunDir: runDir, Editions: []Edition{EditionEnterprise}}, Config: &Config{}, Deps: Deps{
			Run: func(context.Context, commandSpec, io.Writer) error { return errors.New("no git") },
			Now: time.Now,
		}},
		streams: Streams{Out: io.Discard, Err: io.Discard},
	}

	result, err := run.finish(Result{Rows: rows})
	if err != nil {
		t.Fatal(err)
	}

	if result.Findings != 1 || result.Rows[0].Class != ClassRegression {
		t.Fatalf("the judged row is the finding: %d %+v", result.Findings, result.Rows[0])
	}
	mustContain(t, result.Summary, "1 screens, 1 findings")
	verdict, err := os.ReadFile(filepath.Join(runDir, VerdictFile))
	if err != nil {
		t.Fatal(err)
	}
	mustContain(t, string(verdict), "/a: regression · judge: missing-element Save button: gone")
}
