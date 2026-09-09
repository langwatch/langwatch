package sources

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The combined stream has had two shapes. A reader that knows only one finds no
// output for any job, which is what a failed codegen with no visible reason
// looked like on 2026-09-09.
func TestJobOutputIsReadFromEitherShapeOfTheCombinedStream(t *testing.T) {
	dir := t.TempDir()
	combined := filepath.Join(dir, "stack.log")
	lines := strings.Join([]string{
		// The rendered shape the launcher writes now: clock, lane, level, text.
		"23:35:08.662  codegen           Node.js v24.13.0",
		"23:35:08.663  codegen           Error: ENOENT: no such file or directory",
		// The older labeled shape, painted, still on disk in earlier captures.
		"\x1b[90mseed    \x1b[0m │ seeded the local project",
		// A plain pipe, which is what the very first captures used.
		"prepare | migrations applied",
		// A lane that is not a one-shot job is nobody's output here.
		"23:35:09.000  backend           listening on :6560",
	}, "\n")
	if err := os.WriteFile(combined, []byte(lines+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeJournal(t, dir,
		`{"name":"codegen","at":"2026-09-09T23:35:08Z","durationMs":3485,"exit":1}`,
		`{"name":"seed","at":"2026-09-09T23:35:20Z","durationMs":900,"exit":0}`,
		`{"name":"prepare","at":"2026-09-09T23:35:30Z","durationMs":1200,"exit":0}`,
	)

	runs := NewFileJobs(dir, combined).Runs()
	if len(runs) != 3 {
		t.Fatalf("runs = %d, want one per journalled job", len(runs))
	}

	cases := []struct {
		name string
		want string
	}{
		{name: "codegen", want: "Error: ENOENT: no such file or directory"},
		{name: "seed", want: "seeded the local project"},
		{name: "prepare", want: "migrations applied"},
	}
	for _, tc := range cases {
		t.Run("given a "+tc.name+" line", func(t *testing.T) {
			output := strings.Join(outputOf(runs, tc.name), "\n")
			if !strings.Contains(output, tc.want) {
				t.Errorf("%s output = %q, want %q", tc.name, output, tc.want)
			}
			if strings.Contains(output, "listening on :6560") {
				t.Errorf("%s output = %q, want another lane's line left out of it", tc.name, output)
			}
		})
	}

	t.Run("the journal carries the timing and the exit", func(t *testing.T) {
		codegen := runs[0]
		if codegen.Name != "codegen" || codegen.Exit != 1 {
			t.Errorf("first run = %+v, want the failed codegen", codegen)
		}
		if codegen.Duration != 3485*time.Millisecond {
			t.Errorf("duration = %s, want the journalled 3485ms", codegen.Duration)
		}
	})
}

// A stack whose up has not reached its first job yet has no history, not an
// error: that is the ordinary state on frame one.
func TestAStackWithNoJournalHasNoHistory(t *testing.T) {
	dir := t.TempDir()
	if runs := NewFileJobs(dir, filepath.Join(dir, "absent.log")).Runs(); runs != nil {
		t.Errorf("runs = %v, want none", runs)
	}
}

func writeJournal(t *testing.T, dir string, records ...string) {
	t.Helper()
	path := filepath.Join(dir, domain.OnceJobJournal)
	if err := os.WriteFile(path, []byte(strings.Join(records, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func outputOf(runs []JobRun, name string) []string {
	for _, run := range runs {
		if run.Name == name {
			return run.Output
		}
	}
	return nil
}
