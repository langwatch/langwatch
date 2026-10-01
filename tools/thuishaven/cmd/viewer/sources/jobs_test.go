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

// The viewer polls Runs on every beat of its event loop, so the combined
// stream must be read incrementally: a stack whose lane crash-looped leaves a
// stream far too large to re-parse per keystroke (2026-09-14, seconds of input
// latency on the splash screen). Appended lines still arrive, and a rotated
// (shrunken) stream starts the parse over instead of showing stale output.
func TestCombinedStreamIsParsedIncrementallyAcrossPolls(t *testing.T) {
	dir := t.TempDir()
	combined := filepath.Join(dir, "stack.log")
	writeJournal(t, dir,
		`{"name":"codegen","at":"2026-09-14T10:00:00Z","durationMs":100,"exit":0}`,
	)
	if err := os.WriteFile(combined, []byte("23:35:08.662  codegen           first line\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	jobs := NewFileJobs(dir, combined)
	if got := strings.Join(outputOf(jobs.Runs(), "codegen"), "\n"); !strings.Contains(got, "first line") {
		t.Fatalf("first poll output = %q, want the first line", got)
	}

	t.Run("when the stream grows between polls", func(t *testing.T) {
		file, err := os.OpenFile(combined, os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.WriteString("23:35:09.100  codegen           second line\n"); err != nil {
			t.Fatal(err)
		}
		_ = file.Close()
		got := strings.Join(outputOf(jobs.Runs(), "codegen"), "\n")
		if !strings.Contains(got, "first line") || !strings.Contains(got, "second line") {
			t.Errorf("output = %q, want both lines", got)
		}
	})

	t.Run("when a partial last line completes on a later poll", func(t *testing.T) {
		file, err := os.OpenFile(combined, os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.WriteString("23:35:09.200  codegen           half"); err != nil {
			t.Fatal(err)
		}
		_ = file.Close()
		if got := strings.Join(outputOf(jobs.Runs(), "codegen"), "\n"); !strings.Contains(got, "half") {
			t.Errorf("output = %q, want the still-unterminated line shown", got)
		}
		file, err = os.OpenFile(combined, os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.WriteString(" and the rest\n"); err != nil {
			t.Fatal(err)
		}
		_ = file.Close()
		got := strings.Join(outputOf(jobs.Runs(), "codegen"), "\n")
		if !strings.Contains(got, "half and the rest") {
			t.Errorf("output = %q, want the completed line", got)
		}
		if strings.Count(got, "half") != 1 {
			t.Errorf("output = %q, want the completed line exactly once", got)
		}
	})

	t.Run("when the stream is rotated to a shorter file", func(t *testing.T) {
		if err := os.WriteFile(combined, []byte("23:36:00.000  codegen           fresh start\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		got := strings.Join(outputOf(jobs.Runs(), "codegen"), "\n")
		if !strings.Contains(got, "fresh start") {
			t.Errorf("output = %q, want the rotated stream's line", got)
		}
		if strings.Contains(got, "first line") {
			t.Errorf("output = %q, want the pre-rotation lines gone", got)
		}
	})
}
