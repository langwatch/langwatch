package cmd

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/semaphore"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestParseSlotRun(t *testing.T) {
	t.Run("the label defaults to the command", func(t *testing.T) {
		label, argv, err := parseSlotRun([]string{"--", "tsgo", "--noEmit"})
		if err != nil || label != "tsgo" || len(argv) != 2 {
			t.Fatalf("got label=%q argv=%v err=%v", label, argv, err)
		}
	})

	t.Run("an explicit label survives", func(t *testing.T) {
		label, argv, err := parseSlotRun([]string{"--label", "typecheck (wt)", "--", "tsgo"})
		if err != nil || label != "typecheck (wt)" || argv[0] != "tsgo" {
			t.Fatalf("got label=%q argv=%v err=%v", label, argv, err)
		}
	})

	t.Run("no command is an error", func(t *testing.T) {
		if _, _, err := parseSlotRun([]string{"--label", "x", "--"}); err == nil {
			t.Fatal("expected an error for a missing command")
		}
	})
}

// @scenario "haven's slot run is transparent to the command"
// @scenario "Queued whole-tree runs get a soft memory cap at spawn"
func TestSlotRunIsTransparentToTheCommand(t *testing.T) {
	sem := semaphore.New(t.TempDir())
	t.Setenv("CHECK_SLOTS", "1")
	t.Setenv("CI", "")
	t.Setenv("GOMEMLIMIT", "")

	t.Run("a failing command's exit code passes through", func(t *testing.T) {
		var progress bytes.Buffer
		job := &slotJob{sem: sem, label: "failing", argv: []string{"sh", "-c", "exit 7"}, progress: &progress}
		code := job.run(context.Background())
		if code != 7 {
			t.Fatalf("exit code = %d, want 7", code)
		}
		if progress.Len() != 0 {
			t.Fatalf("a run with a free slot must be silent, got %q", progress.String())
		}
	})

	t.Run("the child runs with the gate off and the Go memory cap set", func(t *testing.T) {
		out := filepath.Join(t.TempDir(), "env.txt")
		job := &slotJob{sem: sem, label: "env", argv: []string{
			"sh", "-c", `printf '%s %s' "$CHECK_SLOTS" "$GOMEMLIMIT" > ` + out,
		}, progress: &bytes.Buffer{}}
		code := job.run(context.Background())
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		env, err := os.ReadFile(out)
		if err != nil {
			t.Fatalf("reading the child's env dump: %v", err)
		}
		fields := strings.Fields(string(env))
		if len(fields) != 2 || fields[0] != "0" || !strings.HasSuffix(fields[1], "GiB") {
			t.Fatalf("child env = %q, want CHECK_SLOTS=0 and a GiB GOMEMLIMIT", string(env))
		}
	})

	// The scenario this test is bound to promises two things about the cap, and
	// the subtest above only proves the first. An operator who set a limit did
	// so to override the derived one, so a run that quietly replaced it would
	// take away the only control they have.
	t.Run("an operator's own GOMEMLIMIT reaches the child unchanged", func(t *testing.T) {
		t.Setenv("GOMEMLIMIT", "2GiB")
		out := filepath.Join(t.TempDir(), "env.txt")
		job := &slotJob{sem: sem, label: "operator-limit", argv: []string{
			"sh", "-c", `printf '%s' "$GOMEMLIMIT" > ` + out,
		}, progress: &bytes.Buffer{}}
		if code := job.run(context.Background()); code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		env, err := os.ReadFile(out)
		if err != nil {
			t.Fatalf("reading the child's env dump: %v", err)
		}
		if string(env) != "2GiB" {
			t.Fatalf("child GOMEMLIMIT = %q, want the operator's 2GiB", string(env))
		}
	})
}

// @scenario "Memory pressure lowers the memory ceiling to the floor"
// @scenario "Memory pressure halves the compiler's parallelism"
func TestSlotRunUnderPressure(t *testing.T) {
	sem := semaphore.New(t.TempDir())
	t.Setenv("CHECK_SLOTS", "1")
	t.Setenv("CI", "")
	t.Setenv("GOMEMLIMIT", "")
	t.Setenv("GOMAXPROCS", "")

	t.Run("a pressured run gets the floor and half the cores", func(t *testing.T) {
		out := filepath.Join(t.TempDir(), "env.txt")
		job := &slotJob{sem: sem, label: "pressured", argv: []string{
			"sh", "-c", `printf '%s %s' "$GOMEMLIMIT" "$GOMAXPROCS" > ` + out,
		}, progress: &bytes.Buffer{}, pressure: domain.Red}
		if code := job.run(context.Background()); code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		env, err := os.ReadFile(out)
		if err != nil {
			t.Fatalf("reading the child's env dump: %v", err)
		}
		fields := strings.Fields(string(env))
		if len(fields) != 2 || fields[0] != "3GiB" || fields[1] == "" {
			t.Fatalf("child env = %q, want the 3GiB floor and a GOMAXPROCS cap", string(env))
		}
	})

	t.Run("a green run leaves GOMAXPROCS alone", func(t *testing.T) {
		out := filepath.Join(t.TempDir(), "env.txt")
		job := &slotJob{sem: sem, label: "green", argv: []string{
			"sh", "-c", `printf '%s' "${GOMAXPROCS:-unset}" > ` + out,
		}, progress: &bytes.Buffer{}, pressure: domain.Green}
		if code := job.run(context.Background()); code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		env, err := os.ReadFile(out)
		if err != nil {
			t.Fatalf("reading the child's env dump: %v", err)
		}
		if string(env) != "unset" {
			t.Fatalf("child GOMAXPROCS = %q, want unset on a green machine", string(env))
		}
	})
}

// @scenario "A run killed from outside is reported as not the queue's doing"
func TestSlotRunReportsAnOutsideKill(t *testing.T) {
	sem := semaphore.New(t.TempDir())
	t.Setenv("CHECK_SLOTS", "1")
	t.Setenv("CI", "")

	t.Run("a child killed by a signal nobody forwarded is named", func(t *testing.T) {
		var progress bytes.Buffer
		job := &slotJob{sem: sem, label: "killed", argv: []string{
			"sh", "-c", "kill -KILL $$",
		}, progress: &progress}
		code := job.run(context.Background())
		if code != 137 {
			t.Fatalf("exit code = %d, want 137", code)
		}
		// The message goes to the process stderr rather than the job's progress
		// writer, so capture it around the run.
		// (job.progress carries only queueing chatter, asserted silent here.)
		if progress.Len() != 0 {
			t.Fatalf("queue chatter on a free slot: %q", progress.String())
		}
	})

	t.Run("a child that exits on its own says nothing", func(t *testing.T) {
		stderr := captureStderr(t, func() {
			job := &slotJob{sem: sem, label: "clean", argv: []string{"sh", "-c", "exit 3"}, progress: &bytes.Buffer{}}
			if code := job.run(context.Background()); code != 3 {
				t.Fatalf("exit code = %d, want 3", code)
			}
		})
		if strings.Contains(stderr, "killed from outside") {
			t.Fatalf("a clean exit must not be reported as a kill: %q", stderr)
		}
	})

	t.Run("the kill message names the cause and the wrong fix", func(t *testing.T) {
		stderr := captureStderr(t, func() {
			job := &slotJob{sem: sem, label: "killed", argv: []string{"sh", "-c", "kill -KILL $$"}, progress: &bytes.Buffer{}}
			if code := job.run(context.Background()); code != 137 {
				t.Fatalf("exit code = %d, want 137", code)
			}
		})
		for _, want := range []string{"killed from outside", "signal 9", "never kills", "Do not set CHECK_SLOTS=0"} {
			if !strings.Contains(stderr, want) {
				t.Fatalf("kill report %q is missing %q", stderr, want)
			}
		}
	})
}

// captureStderr runs body with os.Stderr swapped for a pipe and returns what
// was written. slotExec writes the outside-kill report to the real stderr (it
// belongs to the terminal, not the progress writer), so the test reads it the
// same way a person would.
func captureStderr(t *testing.T, body func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	orig := os.Stderr
	os.Stderr = w
	defer func() { os.Stderr = orig }()
	body()
	_ = w.Close()
	os.Stderr = orig
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r); err != nil {
		t.Fatalf("reading captured stderr: %v", err)
	}
	return buf.String()
}

// @scenario "A run queued inside haven says so"
func TestSlotRunQueuesAndSaysSo(t *testing.T) {
	sem := semaphore.New(t.TempDir())
	t.Setenv("CHECK_SLOTS", "1")
	t.Setenv("CI", "")

	release, _, ok, err := sem.TryAcquire(checkSlotName, 1)
	if err != nil || !ok {
		t.Fatalf("could not pre-hold the only slot: ok=%v err=%v", ok, err)
	}

	var progress bytes.Buffer
	done := make(chan int, 1)
	go func() {
		job := &slotJob{sem: sem, label: "queued-run", argv: []string{"true"}, progress: &progress}
		done <- job.run(context.Background())
	}()

	time.Sleep(800 * time.Millisecond)
	release()

	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the queued run never started after the slot freed")
	}

	report := progress.String()
	if !strings.Contains(report, "queued") || !strings.Contains(report, "CHECK_SLOTS") {
		t.Fatalf("a queued run must say so and name the knob, got %q", report)
	}
	if !strings.Contains(report, "slot free after") {
		t.Fatalf("a run that waited must report it, got %q", report)
	}
}
