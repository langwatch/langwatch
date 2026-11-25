package sources

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// @scenario "A partial log write appears once when its line is complete"
func TestPartialCaptureWrite(t *testing.T) {
	dir := t.TempDir()
	file, err := os.Create(filepath.Join(dir, "mail.log"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })
	source := NewFileLogs(dir, time.Time{})
	if _, err := file.WriteString("2026-09-15T10:00:00Z hello"); err != nil {
		t.Fatal(err)
	}
	if lines := source.Fresh(); len(lines) != 0 {
		t.Fatalf("partial record published: %+v", lines)
	}
	if _, err := file.WriteString(" world\n2026-09-15T10:00:01Z next\n"); err != nil {
		t.Fatal(err)
	}
	lines := source.Fresh()
	if len(lines) != 2 || lines[0].Text != "hello world" || lines[1].Text != "next" {
		t.Fatalf("got %+v", lines)
	}
	if lines := source.Fresh(); len(lines) != 0 {
		t.Fatalf("duplicated %+v", lines)
	}
}
