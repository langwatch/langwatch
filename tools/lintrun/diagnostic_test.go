package lintrun_test

import (
	"reflect"
	"testing"

	"github.com/langwatch/langwatch/tools/lintrun"
)

func ptr(s string) *string { return &s }

func at(offset, length, line, column int) []lintrun.Label {
	return []lintrun.Label{{Span: &lintrun.Span{Offset: offset, Length: length, Line: line, Column: column}}}
}

// Shapes as oxlint 1.85 `-f json` prints them; spans are byte offsets into a.ts.
var (
	whole = lintrun.Diagnostic{
		Message:  "Unused oxlint-disable directive (no problems were reported).",
		Severity: "error",
		Filename: "a.ts",
		Labels:   at(100, 60, 4, 1),
	}
	fromNoConsole = lintrun.Diagnostic{
		Message:  "Unused oxlint-disable directive (no problems were reported from no-console).",
		Severity: "error",
		Filename: "a.ts",
		Labels:   at(141, 10, 4, 42),
	}
	finding = lintrun.Diagnostic{
		Message:  "Unexpected console statement.",
		Code:     ptr("eslint(no-console)"),
		Severity: "error",
		Filename: "a.ts",
		Labels:   at(300, 11, 9, 1),
	}
)

func assertMerged(t *testing.T, reports [][]lintrun.Diagnostic, want []lintrun.Diagnostic) {
	t.Helper()
	if got := lintrun.MergeDiagnostics(reports); !reflect.DeepEqual(got, want) {
		t.Errorf("MergeDiagnostics:\n got  %+v\n want %+v", got, want)
	}
}

// @scenario "A disable directive is unused only when no lint process used it"
func TestMergeKeepsAWholeDirectiveReportEveryProcessMakesOnce(t *testing.T) {
	r := []lintrun.Diagnostic{whole}
	assertMerged(t, [][]lintrun.Diagnostic{r, r, r}, []lintrun.Diagnostic{whole})
}

// @scenario "A disable directive is unused only when no lint process used it"
func TestMergeDropsAWholeDirectiveReportAProcessThatUsedItDidNotMake(t *testing.T) {
	assertMerged(t, [][]lintrun.Diagnostic{{whole}, {}}, []lintrun.Diagnostic{})
}

// @scenario "A per-rule unused report stands only where no other process used that rule"
func TestMergeKeepsAPerRuleReportWhereTheOtherProcessUsedNoneOfTheDirective(t *testing.T) {
	assertMerged(t, [][]lintrun.Diagnostic{{fromNoConsole}, {whole}}, []lintrun.Diagnostic{fromNoConsole})
}

// @scenario "A per-rule unused report stands only where no other process used that rule"
func TestMergeDropsAPerRuleReportWhereAnotherProcessUsedThatRule(t *testing.T) {
	assertMerged(t, [][]lintrun.Diagnostic{{fromNoConsole}, {}, {whole}}, []lintrun.Diagnostic{})
}

func TestMergeDoesNotLetAWholeReportInAnotherFileCoverAPerRuleReport(t *testing.T) {
	elsewhere := whole
	elsewhere.Filename = "b.ts"
	assertMerged(t, [][]lintrun.Diagnostic{{fromNoConsole}, {elsewhere}}, []lintrun.Diagnostic{})
}

func TestMergePassesEveryProcessFindingsThrough(t *testing.T) {
	other := finding
	other.Code, other.Message = ptr("langwatch(comment-block-size)"), "Too long."
	assertMerged(t, [][]lintrun.Diagnostic{{finding}, {other}}, []lintrun.Diagnostic{finding, other})
}

func TestSummaryPrintsSortedDiagnosticsWithRuleHelpAndCount(t *testing.T) {
	withHelp := finding
	withHelp.Filename, withHelp.Help = "a.ts", ptr("Remove it.")
	later := finding
	later.Labels = at(0, 1, 9, 7)
	ds := []lintrun.Diagnostic{later, fromNoConsole, withHelp, {Message: "No span.", Filename: "0.ts"}}
	lintrun.SortByPosition(ds)

	want := "0.ts:0:0: No span.\n" +
		"a.ts:4:42: Unused oxlint-disable directive (no problems were reported from no-console).\n" +
		"a.ts:9:1: Unexpected console statement. [eslint(no-console)]\n  help: Remove it.\n" +
		"a.ts:9:7: Unexpected console statement. [eslint(no-console)]\n" +
		"\n4 problem(s)\n"
	if got := lintrun.Summary(ds); got != want {
		t.Errorf("Summary:\n got  %q\n want %q", got, want)
	}
	if got := lintrun.Summary(nil); got != "\n0 problem(s)\n" {
		t.Errorf("empty Summary = %q", got)
	}
}
