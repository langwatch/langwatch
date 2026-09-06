package pi

import (
	"context"
	"os"
	"testing"
	"time"
)

// A worker that stops reading its stdin fills the pipe buffer, and the write
// blocks. That write holds pipesMu, which Post, AbortTurn, the shutdown notice
// and the reader lookup all take, so one wedged worker used to wedge its own
// cancel path for the whole conversation.
//
// @scenario "A command to a worker that stopped reading gives up instead of blocking"
func TestAgent_WriteCommand_BoundedWhenTheWorkerStopsReading(t *testing.T) {
	readEnd, writeEnd, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	// The read end stays open and undrained for the whole test: closing it would
	// make the write fail with EPIPE, which is a different failure from the one
	// under test.
	t.Cleanup(func() {
		_ = readEnd.Close()
		_ = writeEnd.Close()
	})

	agent := NewAgent(time.Second)
	agent.stdin = writeEnd

	// Fill the pipe buffer so the command write below has nowhere to go.
	if err := writeEnd.SetWriteDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("set deadline while filling: %v", err)
	}
	filler := make([]byte, 1<<16)
	for {
		if _, err := writeEnd.Write(filler); err != nil {
			break
		}
	}
	if err := writeEnd.SetWriteDeadline(time.Time{}); err != nil {
		t.Fatalf("clear deadline: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()

	start := time.Now()
	err = agent.writeCommand(ctx, command{Type: "abort", TurnID: "turn-1"})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("writeCommand reported success against a pipe nobody is reading")
	}
	// Generous: the claim is that it RETURNS, not that it is fast. Left
	// unbounded this call never comes back at all.
	if elapsed > 2*time.Second {
		t.Errorf("writeCommand took %v, the caller's deadline was 300ms", elapsed)
	}

	// A failed write has put a partial line on the wire, and the wrapper splits
	// on newlines: the next command would concatenate onto that fragment and
	// both would be unparseable. So the pipe latches broken.
	if err := agent.writeCommand(context.Background(), command{Type: "ping"}); err == nil {
		t.Error("a later command was written onto a half-written line instead of being refused")
	}
}
