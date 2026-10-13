package cell

import (
	"strings"
	"testing"
	"time"
)

func TestParseJobCountersSumsLabels(t *testing.T) {
	scrape := strings.NewReader(`# HELP gq_jobs_completed_total done
# TYPE gq_jobs_completed_total counter
gq_jobs_completed_total{queue="a"} 3
gq_jobs_completed_total{queue="b"} 4
gq_jobs_exhausted_total 0
gq_job_duration_milliseconds_bucket{le="5"} 9
`)
	counters := parseJobCounters(scrape)
	if counters["gq_jobs_completed_total"] != 7 || counters["gq_jobs_exhausted_total"] != 0 || len(counters) != 2 {
		t.Fatalf("counters %v", counters)
	}
}

func TestOldWorkerFindingsReadOnlyTheWindow(t *testing.T) {
	origin := time.Date(2026, 10, 12, 4, 0, 0, 0, time.UTC)
	at := func(ms int64) string {
		return origin.Add(time.Duration(ms) * time.Millisecond).Format(time.RFC3339Nano)
	}
	log := strings.Join([]string{
		`{"level":50,"time":"` + at(1_000) + `","msg":"before the resume: not counted"}`,
		`{"level":30,"time":"` + at(6_000) + `","msg":"fine"}`,
		`{"level":40,"time":"` + at(7_000) + `","msg":"column \"x\" of relation \"Project\" does not exist"}`,
		`{"level":50,"time":"` + at(8_000) + `","msg":"job failed"}`,
		`no time on this line`,
	}, "\n")
	errorLines, schema, lines := oldWorkerFindings(strings.NewReader(log), 5_000, origin)
	if lines != 3 || len(errorLines) != 1 || len(schema) != 1 {
		t.Fatalf("lines %d errors %v schema %v", lines, errorLines, schema)
	}
}

func TestSchemaLineNamesUnknownColumns(t *testing.T) {
	for _, line := range []string{"Code: 47. DB::Exception: Unknown identifier: Foo", "P2022 The column `x` does not exist"} {
		if !schemaLine(line) {
			t.Fatalf("missed %q", line)
		}
	}
	if schemaLine(`{"msg":"ProcessOutboxWorker started"}`) {
		t.Fatal("a plain line counted")
	}
}

func TestSchemaExceptionsSQLScopesTheCellAndWindow(t *testing.T) {
	from := time.Unix(1_000, 0)
	sql := schemaExceptionsSQL("upgradelab_x", from, from.Add(time.Minute))
	for _, want := range []string{"current_database = 'upgradelab_x'", "toDateTime(1000) AND toDateTime(1060)", "NOT ILIKE '%system.backup_log%'", "IN (16, 47, 60)"} {
		if !strings.Contains(sql, want) {
			t.Fatalf("missing %q in %s", want, sql)
		}
	}
}
