package semaphore

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"testing"
	"time"
)

const holderEnv = "SEMAPHORE_TEST_HOLD_DIR"

// TestHoldSlotUntilKilled is the holder process of the reclaim test below: run
// on its own, it takes the only slot, says so, and then waits to be killed.
func TestHoldSlotUntilKilled(t *testing.T) {
	dir := os.Getenv(holderEnv)
	if dir == "" {
		t.Skip("helper process for the reclaim test")
	}
	if _, _, err := New(dir).Acquire(context.Background(), "tc", 1); err != nil {
		t.Fatal(err)
	}
	_, _ = os.Stdout.WriteString("held\n")
	time.Sleep(time.Minute)
}

// @scenario "A slot held by a dead process is reclaimed"
func TestASlotHeldByAKilledProcessGoesToTheNextWaiter(t *testing.T) {
	home := t.TempDir()
	holder := exec.Command(os.Args[0], "-test.run=^TestHoldSlotUntilKilled$") //nolint:gosec // G204: re-runs this test binary as the holder
	holder.Env = append(os.Environ(), holderEnv+"="+home)
	out, err := holder.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := holder.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = holder.Process.Kill(); _ = holder.Wait() })
	if line, err := bufio.NewReader(out).ReadString('\n'); err != nil || line != "held\n" {
		t.Fatalf("the holder did not take the slot: %q %v", line, err)
	}

	waiter := New(home)
	if _, _, ok, err := waiter.TryAcquire("tc", 1); err != nil || ok {
		t.Fatalf("the slot was free while its holder was alive: ok=%v err=%v", ok, err)
	}
	acquired := make(chan int, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	go func() {
		release, slot, err := waiter.Acquire(ctx, "tc", 1)
		if err != nil {
			acquired <- -1
			return
		}
		release()
		acquired <- slot
	}()
	select {
	case slot := <-acquired:
		t.Fatalf("the waiter started (slot %d) while the holder was alive", slot)
	case <-time.After(300 * time.Millisecond):
	}

	// Killed without releasing: no cleanup runs, only the operating system.
	if err := holder.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case slot := <-acquired:
		if slot != 1 {
			t.Fatalf("waiter got slot %d, want the dead holder's slot 1", slot)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the waiting run never started after its holder was killed")
	}
}
