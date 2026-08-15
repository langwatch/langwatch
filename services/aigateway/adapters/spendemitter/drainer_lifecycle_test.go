package spendemitter

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"
)

// The drainer is registered as a lifecycle.Worker, whose Start is
// fire-and-forget and is called synchronously by the lifecycle group's start
// loop. A Start that blocks wedges that loop, so the group never reaches the
// point where it installs its SIGTERM handler and the process dies on the
// default signal disposition instead of shutting down gracefully.
func TestDrainer_Start_returns_immediately(t *testing.T) {
	dir := t.TempDir()
	spool, err := Open(SpoolOptions{Dir: dir, PodID: "test-pod"})
	if err != nil {
		t.Fatalf("open spool: %v", err)
	}
	t.Cleanup(func() { _ = spool.Close() })

	d := NewDrainer(DrainerOptions{Spool: spool, Shipper: nopShipper{}, Tick: time.Millisecond})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	returned := make(chan struct{})
	go func() {
		d.Start(ctx)
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("Start blocked, which wedges the lifecycle group before it arms its signal handler")
	}

	// Stop is only ever called after Start returned, and it must reach the
	// cancel func that Start installed.
	d.Stop()
}

type nopShipper struct{}

func (nopShipper) Ship(context.Context, []Record) error { return nil }

// blockingShipper parks inside Ship until released, so a drain is provably in
// flight while Stop runs. It ignores its context deliberately: the window that
// matters is a drain that has not noticed cancellation yet, which is exactly
// when the spool underneath it must not be closed.
type blockingShipper struct {
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *blockingShipper) Ship(context.Context, []Record) error {
	b.once.Do(func() { close(b.entered) })
	<-b.release
	return nil
}

// Shutdown stops the drainer before it closes the spool, but stopping is only
// a guarantee if it waits. Canceling alone just asks the loop to stop, so a
// drain in the middle of reading or acking a segment would still be running
// against a spool that is being closed underneath it.
//
// @scenario "a drain already in flight finishes before the spool closes"
func TestDrainer_Stop_waits_for_the_drain_loop_to_exit(t *testing.T) {
	spool := openTestSpool(t, t.TempDir())
	t.Cleanup(func() { _ = spool.Close() })

	spool.Append(Record{Command: CommandAdmit, Payload: json.RawMessage(`{"n":1}`)})
	waitForSealed(t, spool, 1)

	ship := &blockingShipper{entered: make(chan struct{}), release: make(chan struct{})}
	d := NewDrainer(DrainerOptions{Spool: spool, Shipper: ship, Tick: time.Millisecond})
	d.Start(t.Context())

	select {
	case <-ship.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("the drain never reached the shipper, so this test proves nothing")
	}

	stopped := make(chan struct{})
	go func() {
		d.Stop()
		close(stopped)
	}()

	select {
	case <-stopped:
		t.Fatal("Stop returned while a drain was still in flight, so the spool can be closed underneath it")
	case <-time.After(200 * time.Millisecond):
	}

	close(ship.release)

	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("Stop never returned after the drain finished")
	}
}
