package visualdiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Run 19b's candidate hung in `tasks prisma-migrate` for 20 minutes with its
// log silent after codegen; haven only wrote "migrations failed" at teardown.
func TestBootWatchOnRun19b(t *testing.T) {
	home := t.TempDir()
	t.Setenv("LANGWATCH_PORTLESS_HOME", home)
	slug := "visualdiff-20260929-185216-candidate"
	path := filepath.Join(home, "logs", slug+".log")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile(filepath.Join("testdata", "run-19b-candidate.log"))
	if err != nil {
		t.Fatal(err)
	}
	before, after, _ := strings.Cut(string(fixture), "haven: migrations failed")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	watch := newBootWatch(slug, 90*time.Second)
	start := time.Now()
	if err := os.WriteFile(path, []byte(before), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := watch.check(start, nil); err != nil {
		t.Fatalf("the boot's own output is progress, got %v", err)
	}
	err = watch.check(start.Add(91*time.Second), nil)
	if err == nil || !strings.Contains(err.Error(), "no log line and no lane change for 1m30s") {
		t.Fatalf("a boot silent past the stall window fails, got %v", err)
	}
	if err := os.WriteFile(path, []byte(before+"haven: migrations failed"+after), 0o600); err != nil {
		t.Fatal(err)
	}
	err = watch.check(start.Add(92*time.Second), nil)
	if err == nil || !strings.Contains(err.Error(), "fatal line") || !strings.Contains(err.Error(), "migrations failed") {
		t.Fatalf("haven's migrations-failed line fails at once, got %v", err)
	}
}
