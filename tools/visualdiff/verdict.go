package visualdiff

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// VerdictFile is the first file an agent reads: one line per flow saying
// whether its feature did its job, and every route with a finding.
const VerdictFile = "verdict.md"

// Verdict is what one flow proved on one edition.
type Verdict string

const (
	// VerdictWorks is every expect holding on both sides and no finding.
	VerdictWorks Verdict = "works"
	// VerdictBroken is the candidate failing where the base does not.
	VerdictBroken Verdict = "broken"
	// VerdictBrokenBoth is a step or expect failing on both sides.
	VerdictBrokenBoth Verdict = "broken-both"
	// VerdictLayoutOnly is every expect holding with the screens drawn differently.
	VerdictLayoutOnly Verdict = "layout-only"
	// VerdictUnproven is a flow with no expect holding on both sides: nothing proves it works.
	VerdictUnproven Verdict = "unproven"
)

// brokenClasses are the findings that say the candidate does not work.
var brokenClasses = map[Classification]bool{
	ClassBroken: true, ClassRegression: true, ClassMissingCandidate: true, ClassNotFound: true,
	ClassBlank: true, ClassAPIError: true,
}

// FlowVerdict is one flow's line in verdict.md.
type FlowVerdict struct {
	Edition Edition
	Flow    string
	Verdict Verdict
	// Proof are the expects that held on both sides.
	Proof []string
	// FirstFailure is the first failing row's step, expect, side and signature, or "".
	FirstFailure string
	failed       Row
}

// JudgeFlows decides every flow's verdict from its rows, in flow then edition order.
func JudgeFlows(rows []Row) []FlowVerdict {
	type flowKey struct {
		edition Edition
		flow    string
	}
	grouped := map[flowKey][]Row{}
	for index := range rows {
		if rows[index].Kind == "flow" {
			key := flowKey{rows[index].Edition, rows[index].Key}
			grouped[key] = append(grouped[key], rows[index])
		}
	}
	verdicts := make([]FlowVerdict, 0, len(grouped))
	for key, flowRows := range grouped {
		sort.SliceStable(flowRows, func(a, b int) bool { return flowRows[a].Index < flowRows[b].Index })
		verdicts = append(verdicts, judgeFlow(key.edition, key.flow, flowRows))
	}
	sort.Slice(verdicts, func(a, b int) bool {
		if verdicts[a].Flow != verdicts[b].Flow {
			return verdicts[a].Flow < verdicts[b].Flow
		}
		return verdicts[a].Edition < verdicts[b].Edition
	})
	return verdicts
}

func judgeFlow(edition Edition, flow string, rows []Row) FlowVerdict {
	verdict := FlowVerdict{Edition: edition, Flow: flow, Proof: FlowProof(rows)}
	broken, brokenBoth, other := firstRow(rows, func(row Row) bool { return brokenClasses[row.Class] }),
		firstRow(rows, func(row Row) bool { return row.Class == ClassBrokenBoth }),
		firstRow(rows, Row.Finding)
	switch {
	case broken != nil:
		verdict.Verdict, verdict.FirstFailure, verdict.failed = VerdictBroken, failureLine(*broken, "candidate"), *broken
	case brokenBoth != nil:
		verdict.Verdict, verdict.FirstFailure, verdict.failed = VerdictBrokenBoth, failureLine(*brokenBoth, "both"), *brokenBoth
	case len(verdict.Proof) == 0:
		verdict.Verdict = VerdictUnproven
	case other != nil:
		verdict.Verdict, verdict.FirstFailure, verdict.failed = VerdictLayoutOnly, failureLine(*other, "candidate"), *other
	default:
		verdict.Verdict = VerdictWorks
	}
	return verdict
}

// FlowProof are a flow's expects that held on both sides, in step order.
func FlowProof(rows []Row) []string {
	var proof []string
	for index := range rows {
		row := rows[index]
		if row.Base == nil || row.Candidate == nil || row.Candidate.Expect == "" {
			continue
		}
		if row.Base.Error == "" && row.Candidate.Error == "" {
			proof = append(proof, row.Candidate.Expect)
		}
	}
	return proof
}

func firstRow(rows []Row, match func(Row) bool) *Row {
	for index := range rows {
		if match(rows[index]) {
			return &rows[index]
		}
	}
	return nil
}

// failureLine is `step N label · expect E · side S · why · console C`.
func failureLine(row Row, side string) string {
	parts := []string{fmt.Sprintf("step %d %s", row.Index, row.Label)}
	if row.Candidate != nil && row.Candidate.Expect != "" {
		parts = append(parts, "expect "+row.Candidate.Expect)
	}
	parts = append(parts, "side "+side, string(row.Class)+": "+row.Why)
	if row.Candidate != nil && len(row.Candidate.ConsoleErrors) > 0 {
		parts = append(parts, "console "+head(row.Candidate.ConsoleErrors[0]))
	}
	return strings.Join(parts, " · ")
}

// RenderVerdict is verdict.md: a flow per line, then routes with a finding,
// then a count of the routes that only rendered alike (never "works").
func RenderVerdict(rows []Row) string {
	var out strings.Builder
	out.WriteString("# visualdiff verdict\n\nflows (works = every expect held on both sides; each finding names its failure, console errors and PNGs):\n")
	for _, verdict := range JudgeFlows(rows) {
		fmt.Fprintf(&out, "- [%s] %s: %s", verdict.Edition, verdict.Flow, verdict.Verdict)
		if len(verdict.Proof) > 0 {
			fmt.Fprintf(&out, " (%d expects held)", len(verdict.Proof))
		}
		out.WriteString("\n")
		if verdict.FirstFailure != "" {
			fmt.Fprintf(&out, "  first failure: %s\n", verdict.FirstFailure)
			out.WriteString(evidence(verdict.failed))
		}
	}
	alike := 0
	out.WriteString("\nroutes with a finding:\n")
	for index := range rows {
		row := rows[index]
		if row.Kind != "route" {
			continue
		}
		if !row.Finding() {
			alike++
			continue
		}
		fmt.Fprintf(&out, "- [%s] %s: %s · %s\n", row.Edition, row.Key, row.Class, head(row.Why))
		out.WriteString(evidence(row))
	}
	fmt.Fprintf(&out, "\n%d routes rendered alike (rendering only, not proof they work)\n", alike)
	return out.String()
}

// evidence is a finding's first failure, console errors and PNG paths, so no
// one opens an image or a log to learn what went wrong.
func evidence(row Row) string {
	var out strings.Builder
	if failure := firstFailure(row); failure != "" {
		fmt.Fprintf(&out, "  failure: %s\n", failure)
	}
	if row.Candidate != nil && len(row.Candidate.ConsoleErrors) > 0 {
		fmt.Fprintf(&out, "  console: %s\n", strings.Join(headAll(row.Candidate.ConsoleErrors, 3), " | "))
	}
	var pngs []string
	if row.Base != nil && row.Base.Screenshot != "" {
		pngs = append(pngs, "base "+row.Base.Screenshot)
	}
	if row.Candidate != nil && row.Candidate.Screenshot != "" {
		pngs = append(pngs, "candidate "+row.Candidate.Screenshot)
	}
	if row.DiffFile != "" {
		pngs = append(pngs, "diff "+row.DiffFile)
	}
	if len(pngs) > 0 {
		fmt.Fprintf(&out, "  pngs: %s\n", strings.Join(pngs, " · "))
	}
	return out.String()
}

// firstFailure is the candidate's step error, else its first failed request.
func firstFailure(row Row) string {
	switch {
	case row.Candidate == nil:
		return ""
	case row.Candidate.Error != "":
		return head(row.Candidate.Error)
	case len(row.Candidate.FailedRequests) > 0:
		return head(row.Candidate.FailedRequests[0])
	}
	return ""
}

func headAll(lines []string, limit int) []string {
	out := make([]string, 0, min(len(lines), limit))
	for _, line := range lines[:min(len(lines), limit)] {
		out = append(out, head(line))
	}
	return out
}

// WriteVerdictFile writes verdict.md into the run directory.
func WriteVerdictFile(runDir string, rows []Row) error {
	return os.WriteFile(filepath.Join(runDir, VerdictFile), []byte(RenderVerdict(rows)), 0o600)
}
