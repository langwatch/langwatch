package fileregistry

import (
	"os"
	"path/filepath"
	"testing"
)

// The never-ask-again set lives beside the registry, not in a worktree: what
// is installed on the machine is the same answer from every checkout, and so
// is the developer's decision about it.
// @scenario "Declining with never is persisted"
func TestPrereqSkipsRoundTripAcrossProcesses(t *testing.T) {
	home := t.TempDir()
	if err := New(home).WritePrereqSkips(map[string]bool{"clickhouse-client": true, "runtime": true}); err != nil {
		t.Fatalf("WritePrereqSkips: %v", err)
	}
	// A second Store, as the next command would build it.
	got := New(home).ReadPrereqSkips()
	if !got["clickhouse-client"] || !got["runtime"] {
		t.Errorf("skips = %v, want both keys", got)
	}
}

// A false value is an absent one: the file records what to skip, so writing
// "clickhouse-client: false" into it would be a record of nothing.
// @scenario "The skips can be cleared"
func TestWritePrereqSkipsDropsTheFalseEntries(t *testing.T) {
	home := t.TempDir()
	s := New(home)
	if err := s.WritePrereqSkips(map[string]bool{"runtime": true, "clickhouse-client": false}); err != nil {
		t.Fatalf("WritePrereqSkips: %v", err)
	}
	got := s.ReadPrereqSkips()
	if len(got) != 1 || !got["runtime"] {
		t.Errorf("skips = %v, want only the true one", got)
	}
}

// @scenario "The skips can be cleared"
func TestWritingAnEmptySetClearsTheFile(t *testing.T) {
	home := t.TempDir()
	s := New(home)
	if err := s.WritePrereqSkips(map[string]bool{"runtime": true}); err != nil {
		t.Fatalf("WritePrereqSkips: %v", err)
	}
	if err := s.WritePrereqSkips(map[string]bool{}); err != nil {
		t.Fatalf("WritePrereqSkips: %v", err)
	}
	if got := s.ReadPrereqSkips(); len(got) != 0 {
		t.Errorf("skips = %v, want empty", got)
	}
}

// A preference nobody has expressed yet is not a failure, and neither is a
// half-written file: either way the honest answer is "nothing is skipped",
// and anything else would let a truncated file block the command entirely.
// @scenario "Declining with never is persisted"
func TestUnreadableSkipsReadAsNoneRatherThanFailing(t *testing.T) {
	home := t.TempDir()
	if got := New(home).ReadPrereqSkips(); len(got) != 0 {
		t.Errorf("with no file at all, skips = %v, want empty", got)
	}
	if err := os.WriteFile(filepath.Join(home, "install-skips.json"), []byte("{\"skipped\": ["), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if got := New(home).ReadPrereqSkips(); len(got) != 0 {
		t.Errorf("with a truncated file, skips = %v, want empty", got)
	}
}
