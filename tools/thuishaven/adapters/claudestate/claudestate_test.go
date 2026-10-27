package claudestate

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// write lays one file of n bytes at path and stamps it age ago.
func write(t *testing.T, path string, n int, age time.Duration, now time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, make([]byte, n), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	stamp := now.Add(-age)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
}

// @scenario "A directory still in daily use is judged on the age of its bytes, not its own mtime"
func TestStatMeasuresTheColdShare(t *testing.T) {
	now := time.Now()
	dir := t.TempDir()

	t.Run("given a directory appended to today whose files are mostly a year old", func(t *testing.T) {
		write(t, filepath.Join(dir, "old", "2025.jsonl"), 900, 365*24*time.Hour, now)
		write(t, filepath.Join(dir, "today.jsonl"), 100, time.Minute, now)

		t.Run("when it is measured", func(t *testing.T) {
			rec, ok := Reader{}.Stat(context.Background(), dir, now.Add(-domain.ClaudeStateCold))
			if !ok {
				t.Fatal("an existing directory should be measurable")
			}
			if rec.Bytes != 1000 {
				t.Errorf("Bytes = %d, want 1000", rec.Bytes)
			}
			if rec.ColdBytes != 900 {
				t.Errorf("ColdBytes = %d, want 900 — the cold share is summed per file", rec.ColdBytes)
			}
			// The newest write is today's, not the old file's: a directory still in
			// use must not read as untouched just because most of it is.
			if now.Sub(rec.Newest) > time.Hour {
				t.Errorf("Newest = %v, want today's write", rec.Newest)
			}
		})
	})

	t.Run("given a path that is not a directory", func(t *testing.T) {
		if _, ok := (Reader{}).Stat(context.Background(), filepath.Join(dir, "today.jsonl"), now); ok {
			t.Error("a file is not a location")
		}
		if _, ok := (Reader{}).Stat(context.Background(), filepath.Join(dir, "absent"), now); ok {
			t.Error("an absent path is not a location")
		}
	})
}

// @scenario "Claude's working files outside its home are read too"
func TestReadSplitsPerEntryLocations(t *testing.T) {
	now := time.Now()
	home := t.TempDir()
	write(t, filepath.Join(home, "projects", "-repo-a", "a.jsonl"), 10, time.Hour, now)
	write(t, filepath.Join(home, "projects", "-repo-b", "b.jsonl"), 20, time.Hour, now)
	write(t, filepath.Join(home, "cache", "nested", "c.bin"), 30, time.Hour, now)

	t.Run("when a per-entry location is read", func(t *testing.T) {
		recs, err := Reader{}.Read(context.Background(), domain.ClaudeScan{Root: home, Loc: domain.ClaudeLocation{Name: "projects", PerEntry: true}, ColdBefore: now})
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		if len(recs) != 2 {
			t.Fatalf("want one record per child, got %d", len(recs))
		}
	})

	t.Run("when a whole-directory location is read", func(t *testing.T) {
		recs, err := Reader{}.Read(context.Background(), domain.ClaudeScan{Root: home, Loc: domain.ClaudeLocation{Name: "cache"}, ColdBefore: now})
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		if len(recs) != 1 || recs[0].Name != "cache" || recs[0].Bytes != 30 {
			t.Fatalf("want one record named cache holding 30 bytes, got %+v", recs)
		}
	})

	t.Run("when the location is the root itself", func(t *testing.T) {
		tmp := t.TempDir()
		write(t, filepath.Join(tmp, "-repo-a", "session.json"), 40, time.Hour, now)
		recs, err := Reader{}.Read(context.Background(), domain.ClaudeScan{Root: tmp, Loc: domain.ClaudeLocation{Name: "", PerEntry: true}, ColdBefore: now})
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		if len(recs) != 1 || recs[0].Name != "-repo-a" {
			t.Fatalf("the root's own children are the records, got %+v", recs)
		}
	})

	t.Run("when a location has never been written", func(t *testing.T) {
		recs, err := Reader{}.Read(context.Background(), domain.ClaudeScan{Root: home, Loc: domain.ClaudeLocation{Name: "telemetry"}, ColdBefore: now})
		if err != nil || len(recs) != 0 {
			t.Errorf("an absent location reports nothing rather than failing: %v %+v", err, recs)
		}
	})
}
