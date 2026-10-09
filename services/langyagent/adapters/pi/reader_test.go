package pi

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

func startTestReader(t *testing.T) (*reader, io.WriteCloser) {
	t.Helper()
	pr, pw := io.Pipe()
	r := newReader(pr)
	go r.run(context.Background())
	t.Cleanup(func() { _ = pw.Close() })
	return r, pw
}

func expectEvent(t *testing.T, mb *mailbox, wantType string) wireEvent {
	t.Helper()
	select {
	case ev := <-mb.ch:
		if ev.Type != wantType {
			t.Fatalf("event type = %q, want %q", ev.Type, wantType)
		}
		return ev
	case <-time.After(3 * time.Second):
		t.Fatalf("no %q event arrived", wantType)
		return wireEvent{}
	}
}

// An oversized line (over the 4MB cap) is discarded WITHOUT wedging the
// stream: the reader resumes at the next newline and the following event
// routes normally. This is the exact failure bufio.Scanner cannot recover
// from (ErrTooLong is terminal there).
func TestReader_OversizedLineIsSkippedNotFatal(t *testing.T) {
	r, w := startTestReader(t)
	mb := r.register("t1")
	defer r.unregister("t1", mb)

	go func() {
		// 5MB without a newline, then the newline, then a valid event.
		chunk := strings.Repeat("x", 1024*1024)
		for range 5 {
			_, _ = w.Write([]byte(chunk))
		}
		_, _ = w.Write([]byte("\n"))
		_, _ = w.Write([]byte(`{"type":"delta","turnId":"t1","text":"still alive"}` + "\n"))
	}()

	ev := expectEvent(t, mb, eventDelta)
	if ev.Text != "still alive" {
		t.Errorf("delta text = %q", ev.Text)
	}
}

// An unparseable line is skipped; the events around it still route.
func TestReader_UnparseableLineIsSkipped(t *testing.T) {
	r, w := startTestReader(t)
	mb := r.register("t1")
	defer r.unregister("t1", mb)

	go func() {
		_, _ = w.Write([]byte("not json at all\n"))
		_, _ = w.Write([]byte(`{"type":"turn_started","turnId":"t1"}` + "\n"))
	}()

	expectEvent(t, mb, eventTurnStarted)
}

// EOF mid-frame closes the dead channel; the partial trailing fragment is not
// delivered as an event.
func TestReader_EOFClosesDead(t *testing.T) {
	r, w := startTestReader(t)
	mb := r.register("t1")
	defer r.unregister("t1", mb)

	_, _ = w.Write([]byte(`{"type":"delta","turnId":"t1","text":"one"}` + "\n"))
	expectEvent(t, mb, eventDelta)
	// A fragment with no newline, then EOF.
	_, _ = w.Write([]byte(`{"type":"delta","turnId":"t1","tex`))
	_ = w.Close()

	select {
	case <-r.dead:
	case <-time.After(3 * time.Second):
		t.Fatal("dead channel never closed on EOF")
	}
	select {
	case ev := <-mb.ch:
		t.Fatalf("partial trailing fragment was delivered as %+v", ev)
	default:
	}
}

// The ready handshake closes the ready channel exactly once; a second ready is
// harmless.
func TestReader_ReadyHandshake(t *testing.T) {
	r, w := startTestReader(t)
	_, _ = w.Write([]byte(`{"type":"ready","protocol":1}` + "\n"))
	select {
	case <-r.ready:
	case <-time.After(3 * time.Second):
		t.Fatal("ready never closed")
	}
	_, _ = w.Write([]byte(`{"type":"ready","protocol":1}` + "\n"))
}

// Events for a turn with no registered mailbox are dropped, and delivery to a
// detached mailbox does not block the reader.
func TestReader_UnknownTurnAndDetachedMailboxNeverBlock(t *testing.T) {
	r, w := startTestReader(t)

	// No mailbox at all.
	_, _ = w.Write([]byte(`{"type":"delta","turnId":"ghost","text":"x"}` + "\n"))

	// A detached mailbox with a FULL buffer: the reader must not block.
	mb := r.register("t2")
	for i := 0; i < cap(mb.ch); i++ {
		mb.ch <- wireEvent{}
	}
	r.unregister("t2", mb)
	_, _ = w.Write([]byte(`{"type":"delta","turnId":"t2","text":"y"}` + "\n"))

	// Prove the reader is still consuming: a routable event still arrives.
	live := r.register("t3")
	defer r.unregister("t3", live)
	_, _ = w.Write([]byte(`{"type":"delta","turnId":"t3","text":"alive"}` + "\n"))
	ev := expectEvent(t, live, eventDelta)
	if ev.Text != "alive" {
		t.Errorf("delta text = %q", ev.Text)
	}
}
