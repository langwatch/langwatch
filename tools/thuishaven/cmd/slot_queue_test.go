package cmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/semaphore"
)

// redirectStdio points the process's stdout and stderr at files for one test,
// which is where slotExec sends the wrapped command's output.
func redirectStdio(t *testing.T) (stdout, stderr string) {
	t.Helper()
	dir := t.TempDir()
	stdout, stderr = filepath.Join(dir, "stdout"), filepath.Join(dir, "stderr")
	outFile, err := os.Create(stdout)
	if err != nil {
		t.Fatal(err)
	}
	errFile, err := os.Create(stderr)
	if err != nil {
		t.Fatal(err)
	}
	realOut, realErr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = outFile, errFile
	t.Cleanup(func() {
		os.Stdout, os.Stderr = realOut, realErr
		_ = outFile.Close()
		_ = errFile.Close()
	})
	return stdout, stderr
}

func readText(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// @scenario "The wrapper is transparent to the command it runs"
func TestSlotRunPassesTheCommandsOutputAndExitCodeThrough(t *testing.T) {
	t.Setenv("CHECK_SLOTS", "1")
	t.Setenv("CI", "")
	stdout, stderr := redirectStdio(t)

	var progress bytes.Buffer
	job := &slotJob{
		sem: semaphore.New(t.TempDir()), label: "failing", progress: &progress,
		argv: []string{"sh", "-c", `printf 'to-stdout\n'; printf 'to-stderr\n' >&2; exit 7`},
	}
	if code := job.run(context.Background()); code != 7 {
		t.Fatalf("exit code = %d, want the command's 7", code)
	}
	if got := readText(t, stdout); got != "to-stdout\n" {
		t.Errorf("stdout = %q, want exactly what the command wrote", got)
	}
	if got := readText(t, stderr); got != "to-stderr\n" {
		t.Errorf("stderr = %q, want exactly what the command wrote", got)
	}
	if progress.Len() != 0 {
		t.Errorf("the wrapper added %q of its own to a run that found a free slot", progress.String())
	}
}

// unavailableSlots is a slot directory that cannot be created or written.
type unavailableSlots struct{}

func (unavailableSlots) TryAcquire(string, int) (func(), int, bool, error) {
	return nil, 0, false, errors.New("mkdir /nowhere: permission denied")
}

// @scenario "A queue that cannot be created degrades to an unqueued run"
func TestSlotRunRunsWithoutASlotWhenTheQueueCannotBeCreated(t *testing.T) {
	t.Setenv("CHECK_SLOTS", "1")
	t.Setenv("CI", "")
	marker := filepath.Join(t.TempDir(), "ran")

	var progress bytes.Buffer
	job := &slotJob{
		sem: unavailableSlots{}, label: "no-queue", progress: &progress,
		argv: []string{"sh", "-c", `printf ran > ` + marker},
	}
	if code := job.run(context.Background()); code != 0 {
		t.Fatalf("exit code = %d, want 0: the queue is a courtesy, never a gate", code)
	}
	if got := readText(t, marker); got != "ran" {
		t.Fatalf("the command did not run without a slot (marker %q)", got)
	}
	report := progress.String()
	if !strings.Contains(report, "queue unavailable") || !strings.Contains(report, "running without a slot") {
		t.Fatalf("progress = %q, want a warning that the queue is unavailable and the run goes without a slot", report)
	}
}

// heldSlots is a queue whose every slot is taken, and which makes the waiting
// job believe it joined the queue longer ago than the maximum wait.
type heldSlots struct {
	job   *slotJob
	ago   time.Duration
	polls int
}

func (h *heldSlots) TryAcquire(string, int) (func(), int, bool, error) {
	h.polls++
	h.job.queuedAt = time.Now().Add(-h.ago)
	return nil, 0, false, nil
}

// @scenario "A run that waits too long runs anyway"
func TestSlotRunStartsAnywayOnceTheMaximumWaitHasElapsed(t *testing.T) {
	t.Setenv("CHECK_SLOTS", "1")
	t.Setenv("CI", "")
	marker := filepath.Join(t.TempDir(), "ran")

	var progress bytes.Buffer
	job := &slotJob{label: "stuck-queue", progress: &progress, argv: []string{"sh", "-c", `printf ran > ` + marker}}
	held := &heldSlots{job: job, ago: slotMaxWait + time.Minute}
	job.sem = held

	done := make(chan int, 1)
	go func() { done <- job.run(context.Background()) }()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the run kept waiting past the maximum wait instead of running")
	}
	if held.polls != 1 {
		t.Errorf("polled the queue %d times, want one re-check before giving up", held.polls)
	}
	if got := readText(t, marker); got != "ran" {
		t.Fatalf("the command did not run after the maximum wait (marker %q)", got)
	}
	report := progress.String()
	if !strings.Contains(report, "no slot after") || !strings.Contains(report, "starting anyway") {
		t.Fatalf("progress = %q, want a warning that the run is starting without a slot", report)
	}
}
