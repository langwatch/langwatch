package spendemitter

import (
	"context"
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
