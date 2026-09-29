package visualdiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func flowRow(index int, class Classification, expect, baseError, candidateError string) Row {
	return Row{
		Edition: EditionEnterprise, Kind: "flow", Key: "automation-create", Index: index, Label: "expect: after", Class: class,
		Why:       "why",
		Base:      &Capture{Expect: expect, Error: baseError},
		Candidate: &Capture{Expect: expect, Error: candidateError, ConsoleErrors: []string{"TypeError: x is undefined"}},
	}
}

// @scenario "A flow's expect proves the feature did its job on both sides"
func TestAFlowWhoseExpectsHoldWorksAndKeepsItsProof(t *testing.T) {
	rows := []Row{flowRow(0, ClassNoise, "", "", ""), flowRow(100, ClassNoise, `text "VD Automation"`, "", "")}

	verdicts := JudgeFlows(rows)

	if len(verdicts) != 1 || verdicts[0].Verdict != VerdictWorks || len(verdicts[0].Proof) != 1 {
		t.Fatalf("verdicts: %+v", verdicts)
	}
	rows[1].Class = ClassLayout
	if verdict := JudgeFlows(rows)[0]; verdict.Verdict != VerdictLayoutOnly {
		t.Fatalf("a held expect with moved pixels is layout-only: %+v", verdict)
	}
	if verdict := JudgeFlows(rows[:1])[0]; verdict.Verdict != VerdictUnproven {
		t.Fatalf("a flow with no expect proves nothing: %+v", verdict)
	}
}

// @scenario "verdict.md names each finding's class, first failure, console errors and PNGs"
func TestVerdictNamesTheFirstFailure(t *testing.T) {
	failing := `expect text "VD Automation": not visible after 10000ms`
	rows := []Row{
		flowRow(100, ClassBroken, `text "VD Automation"`, "", failing),
		{Edition: EditionEnterprise, Kind: "route", Key: "/a", Class: ClassNoise},
		{
			Edition: EditionEnterprise, Kind: "route", Key: "/b", Class: ClassBlank, Why: "blank page", DiffFile: "/run/diff/b.png",
			Base: &Capture{Screenshot: "/run/base/b.png"},
			Candidate: &Capture{
				Screenshot: "/run/candidate/b.png", FailedRequests: []string{"GET /api/b 500"},
				ConsoleErrors: []string{"ChunkLoadError: b"},
			},
		},
	}

	verdict := RenderVerdict(rows)

	for _, want := range []string{
		"automation-create: broken",
		`first failure: step 100 expect: after · expect text "VD Automation" · side candidate`,
		"console TypeError",
		"/b: blank",
		"  failure: GET /api/b 500",
		"  console: ChunkLoadError: b",
		"  pngs: base /run/base/b.png · candidate /run/candidate/b.png · diff /run/diff/b.png",
		"1 routes rendered alike",
	} {
		mustContain(t, verdict, want)
	}
	rows[0].Class, rows[0].Base.Error = ClassBrokenBoth, failing
	mustContain(t, RenderVerdict(rows), "automation-create: broken-both")
}

// @scenario "A section marked done keeps its proof and is skipped by later runs"
func TestFlowProofIsOnlyExpectsHoldingOnBothSides(t *testing.T) {
	rows := []Row{flowRow(0, ClassNoise, `url /x`, "", ""), flowRow(100, ClassBroken, `text "y"`, "", "failed")}
	if proof := FlowProof(rows); len(proof) != 1 || proof[0] != "url /x" {
		t.Fatalf("proof: %v", proof)
	}
}

// @scenario "signatures.md splits log signatures new on the candidate from those also on the base"
func TestSignaturesSplitNewOnTheCandidateFromAlsoOnTheBase(t *testing.T) {
	dir := t.TempDir()
	logs := map[string]string{
		"base-dev.log": `{"level":50,"name":"api","msg":"db down","err":{"message":"conn 1234 refused"}}` + "\n" +
			"2026-09-29T10:00:00Z info starting\n",
		"candidate-dev.log": `{"level":50,"name":"api","msg":"db down","err":{"message":"conn 98765 refused"}}` + "\n" +
			"\x1b[31m[worker] ERROR job abcdef0123456789 failed {\"x\":1}\x1b[0m\n" +
			"[worker] ERROR job 0123456789abcdef failed\n",
	}
	for name, content := range logs {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	signatures, err := ScanSignatures(dir)
	if err != nil {
		t.Fatal(err)
	}
	rendered := RenderSignatures(signatures)

	newOnCandidate, alsoOnBase, _ := strings.Cut(rendered, "## also on the base")
	mustContain(t, newOnCandidate, "2 error candidate-dev.log:2 | ERROR job # failed")
	mustContain(t, alsoOnBase, "api: db down | conn # refused")
	if strings.Contains(rendered, "starting") {
		t.Fatal("an info line is not a signature")
	}
}
