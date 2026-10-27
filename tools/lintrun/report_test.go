package lintrun_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/lintrun"
)

// What oxlint 1.85 printed for langwatch#9094, whose every lintable path was ignored.
const noFilesOutput = `No files found to lint. Please check your paths and ignore patterns.
{ "diagnostics": [],
              "number_of_files": 0,
              "number_of_rules": null,
              "threads_count": 2,
              "start_time": 0.000315769
            }
`

// @scenario "A change whose lintable files are all ignored passes"
func TestParseReportReadsNoFilesFoundAsACleanRun(t *testing.T) {
	ds, ok := lintrun.ParseReport(noFilesOutput, 1)
	if !ok || len(ds) != 0 {
		t.Errorf("ParseReport(no files, 1) = %v, %v; want no diagnostics, ok", ds, ok)
	}
}

func TestParseReportReadsDiagnostics(t *testing.T) {
	ds, ok := lintrun.ParseReport(`{"diagnostics":[{"message":"m","code":"eslint(x)","filename":"a.ts"}]}`, 1)
	if !ok || len(ds) != 1 || ds[0].Message != "m" || *ds[0].Code != "eslint(x)" {
		t.Errorf("ParseReport = %+v, %v", ds, ok)
	}
}

func TestParseReportRefusesAFailedRun(t *testing.T) {
	for _, c := range []struct {
		out    string
		status int
	}{
		{`{"diagnostics":[]}`, 2},
		{noFilesOutput, 2},
		{"Failed to parse configuration file.", 1},
		{`{"number_of_files": 3}`, 0},
	} {
		if _, ok := lintrun.ParseReport(c.out, c.status); ok {
			t.Errorf("ParseReport(%q, %d) ok, want a failed run", c.out, c.status)
		}
	}
}

func TestJudgedWithoutTypes(t *testing.T) {
	typeOnly := map[string]bool{"no-floating-promises": true, "no-misused-promises": true}
	lines := []string{
		"// oxlint-disable-next-line typescript/no-floating-promises, no-misused-promises -- why",
		"// oxlint-disable-next-line no-console, typescript/no-floating-promises",
		"/* eslint-disable-line */",
	}
	source := []byte(strings.Join(lines, "\n") + "\n")
	unusedOn := func(line string) lintrun.Diagnostic {
		return lintrun.Diagnostic{
			Message:  "Unused oxlint-disable directive (no problems were reported).",
			Filename: "a.ts",
			Labels:   at(bytes.Index(source, []byte(line)), len(line), 1, 1),
		}
	}
	cases := []struct {
		name string
		d    lintrun.Diagnostic
		want bool
	}{
		{"names only type-aware rules", unusedOn(lines[0]), false},
		{"names a rule this run has", unusedOn(lines[1]), true},
		{"names no rule", unusedOn(lines[2]), true},
		{"is a finding", finding, true},
	}
	for _, c := range cases {
		if got := lintrun.JudgedWithoutTypes(c.d, source, typeOnly); got != c.want {
			t.Errorf("a directive that %s: judged = %v, want %v", c.name, got, c.want)
		}
	}
}
