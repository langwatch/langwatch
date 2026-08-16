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
