package cmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
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
		wantProcs := strconv.Itoa(max(2, runtime.NumCPU()/2))
		if len(fields) != 2 || fields[0] != "3GiB" || fields[1] != wantProcs {
			t.Fatalf("child env = %q, want the 3GiB floor and GOMAXPROCS=%s", string(env), wantProcs)
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

// @scenario "An interrupted run killed from outside is still reported"
func TestReportOutsideKillReadsTheSignalThatKilled(t *testing.T) {
	// A real SIGKILL death, so the Wait error carries the wait status the
	// wrapper reads rather than a synthetic one.
	killed := exec.Command("sh", "-c", "kill -KILL $$").Run()
	if killed == nil {
		t.Fatal("the probe command was supposed to die by SIGKILL")
	}

	t.Run("a forwarded SIGINT does not excuse a SIGKILL", func(t *testing.T) {
		out := captureStderr(t, func() {
			reportOutsideKill(killed, "sh", slotDeath{
				forwarded: map[syscall.Signal]bool{syscall.SIGINT: true},
			})
		})
		if !strings.Contains(out, "killed from outside") {
			t.Fatalf("an escalation after an interrupt must still be named, got %q", out)
		}
	})

	t.Run("the signal the wrapper forwarded is not reported", func(t *testing.T) {
		out := captureStderr(t, func() {
			reportOutsideKill(killed, "sh", slotDeath{
				forwarded: map[syscall.Signal]bool{syscall.SIGKILL: true},
			})
		})
		if strings.Contains(out, "killed from outside") {
			t.Fatalf("the wrapper must not blame a kill it sent: %q", out)
		}
	})

	t.Run("a run the wrapper canceled is not an outside kill", func(t *testing.T) {
		out := captureStderr(t, func() {
			reportOutsideKill(killed, "sh", slotDeath{canceled: true})
		})
		if strings.Contains(out, "killed from outside") {
			t.Fatalf("cancellation is the wrapper's own doing: %q", out)
		}
	})

	// exec.CommandContext kills with SIGKILL on cancellation, which no
	// forwarded-signal record accounts for, so this path needs the real thing.
	t.Run("a canceled context stays quiet end to end", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		out := captureStderr(t, func() {
			go func() {
				time.Sleep(100 * time.Millisecond)
				cancel()
			}()
			slotExec(ctx, []string{"sh", "-c", "sleep 5"}, domain.Green)
		})
		if strings.Contains(out, "killed from outside") {
			t.Fatalf("a canceled run must not be reported as an outside kill: %q", out)
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

// @scenario "A borrowed held-marker does not turn the queue off"
// @scenario "An agent's own shell is not a queue wrapper"
func TestHeldByQueueAncestor(t *testing.T) {
	// The chain walk on its own: the test binary's parent really is above us.
	// The full check refuses it all the same, because that parent runs "go
	// test", not the queue. An agent's CHECK_QUEUE_HELD=$$ has exactly this
	// shape, and this is what stops it.
	if !isLiveAncestor(os.Getppid()) {
		t.Fatal("the test binary's own parent must count as a live ancestor")
	}
	if heldByQueueAncestor(strconv.Itoa(os.Getppid())) {
		t.Fatal("an ancestor that is not a queue wrapper must not verify")
	}

	for _, raw := range []string{"", "1", "0", "-4", "bananas"} {
		if heldByQueueAncestor(raw) {
			t.Fatalf("%q must not verify as a held marker", raw)
		}
	}

	// A live process that is not above us: an agent copying a wrapper's pid
	// into its own environment is exactly this shape.
	bystander := exec.Command("sleep", "30")
	if err := bystander.Start(); err != nil {
		t.Fatalf("starting the bystander: %v", err)
	}
	defer func() {
		_ = bystander.Process.Kill()
		_ = bystander.Wait()
	}()
	if heldByQueueAncestor(strconv.Itoa(bystander.Process.Pid)) {
		t.Fatal("a live process that is not an ancestor must not verify")
	}
}

// @scenario "An agent's own shell is not a queue wrapper"
func TestIsQueueCommand(t *testing.T) {
	accepted := []string{
		"node /repo/dev/scripts/check-queue.mjs pnpm typecheck",
		"haven slot run --label typecheck -- pnpm typecheck",
		"/Users/someone/go/bin/haven typecheck",
		"/var/folders/T/go-build/b001/haven.test -test.run TestX",
	}
	for _, command := range accepted {
		if !isQueueCommand(command) {
			t.Fatalf("%q must read as a queue wrapper", command)
		}
	}

	refused := []string{
		"",
		"   ",
		"-zsh",
		"/bin/bash -l",
		"node /repo/platform/app/scripts/__tests__/check-queue.unit.test.ts",
		"/opt/homebrew/bin/havenclone slot run",
	}
	for _, command := range refused {
		if isQueueCommand(command) {
			t.Fatalf("%q must not read as a queue wrapper", command)
		}
	}
}

// @scenario "A signal delivered to the whole process group still counts as forwarded"
func TestSignalRelayRecordsAQueuedSignal(t *testing.T) {
	child := exec.Command("sleep", "10")
	if err := child.Start(); err != nil {
		t.Fatalf("starting the stand-in child: %v", err)
	}
	defer func() {
		_ = child.Process.Kill()
		_ = child.Wait()
	}()

	// A Ctrl-C at a terminal reaches the wrapper and the child together, so the
	// wrapper's own copy of the signal can still be queued at the moment the
	// child is already gone and the relay closes.
	signals := make(chan os.Signal, 4)
	relay := newSignalRelay(signals)
	signals <- syscall.SIGINT
	go relay.pump(child.Process)

	if forwarded := relay.close(); !forwarded[syscall.SIGINT] {
		t.Fatal("a signal queued when the child died must still count as forwarded, or the wrapper reports the operator's own interrupt as a kill from outside")
	}
}

// @scenario "An interrupt that arrives as the command starts is forwarded"
func TestSignalRelayForwardsASignalThatArrivedBeforeTheChild(t *testing.T) {
	child := exec.Command("sleep", "10")
	if err := child.Start(); err != nil {
		t.Fatalf("starting the stand-in child: %v", err)
	}

	// The wrapper listens before it starts the command, so an interrupt in
	// between is already waiting when forwarding begins. Dropping it there
	// would leave the operator's Ctrl-C unanswered and the command running.
	signals := make(chan os.Signal, 4)
	relay := newSignalRelay(signals)
	signals <- syscall.SIGTERM
	relay.forwardTo(child.Process)

	err := child.Wait()
	relay.close()

	exit := &exec.ExitError{}
	if !errors.As(err, &exit) {
		t.Fatalf("the child must end by the forwarded signal, got %v", err)
	}
	status, ok := exit.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGTERM {
		t.Fatalf("the child must be ended by SIGTERM, got %v", exit)
	}
}
