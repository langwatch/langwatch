package fileregistry

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// @scenario "An Nx run leaves one history row per task"
func TestAppendNxHistoryKeepsNewestRowsApartFromRunHistory(t *testing.T) {
	home := t.TempDir()
	s := New(home)
	rows := make([]string, 0, NxHistoryCap+3)
	for i := range NxHistoryCap + 3 {
		rows = append(rows, fmt.Sprintf(`{"n":%d}`, i))
	}
	if err := s.AppendNxHistory(rows[:2]); err != nil {
		t.Fatal(err)
	}
	if err := s.AppendNxHistory(rows[2:]); err != nil {
		t.Fatal(err)
	}
	got := s.NxHistory()
	if len(got) != NxHistoryCap {
		t.Fatalf("kept %d rows, want %d", len(got), NxHistoryCap)
	}
	if got[0] != `{"n":3}` || got[len(got)-1] != fmt.Sprintf(`{"n":%d}`, NxHistoryCap+2) {
		t.Fatalf("kept the wrong rows: first %s last %s", got[0], got[len(got)-1])
	}
	if _, err := os.Stat(filepath.Join(home, "run-history.jsonl")); !os.IsNotExist(err) {
		t.Fatalf("run-history.jsonl was touched: %v", err)
	}
}
