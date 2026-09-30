package diffsuite

import (
	"strings"
	"testing"
	"time"
)

func TestStatusLinePrefersProgressOverLastLine(t *testing.T) {
	tool := &tool{name: "api"}
	for _, text := range []string{"boot", "412 run, 3 failed", "noise after"} {
		tool.noteLine(text)
	}
	got := statusLine(tool, 12*time.Minute+3*time.Second, "3.21 2.90 2.50")
	if want := "[api] RUNNING 12m3s load 3.21 2.90 2.50: 412 run, 3 failed"; got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestStatusLineFallsBackToLastLine(t *testing.T) {
	tool := &tool{name: "custom"}
	tool.noteLine("hello")
	tool.noteLine("   ")
	if got := statusLine(tool, time.Second, "?"); !strings.HasSuffix(got, ": hello") {
		t.Fatal(got)
	}
	if got := statusLine(&tool2, time.Second, "?"); !strings.HasSuffix(got, "(no output yet)") {
		t.Fatal(got)
	}
}

var tool2 = tool{name: "quiet"}

func TestLoadAverageReadsBothSpellings(t *testing.T) {
	mac := "12:00  up 3 days, 2 users, load averages: 3.21 2.90 2.50"
	linux := " 12:00:01 up 3 days,  1 user,  load average: 0.10, 0.20, 0.30"
	if got := loadAverage(mac); got != "3.21 2.90 2.50" {
		t.Fatal(got)
	}
	if got := loadAverage(linux); got != "0.10 0.20 0.30" {
		t.Fatal(got)
	}
	if got := loadAverage("garbage"); got != "?" {
		t.Fatal(got)
	}
}

func TestSummaryTableCarriesHeadline(t *testing.T) {
	done := &tool{name: "visual", exit: 1, took: 90 * time.Second}
	done.noteLine("visual: 12 flows passed, 2 failed")
	table := summaryTable([]*tool{done})
	if !strings.Contains(table, "visual") || !strings.Contains(table, "1m30s") || !strings.Contains(table, "12 flows passed") {
		t.Fatal(table)
	}
}
