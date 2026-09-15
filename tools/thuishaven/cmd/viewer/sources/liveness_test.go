package sources

import (
	"net"
	"sync/atomic"
	"testing"
	"time"
)

// countingListener answers on loopback and counts how many connections were
// actually made to it, which is the only honest way to ask "how often did the
// viewer dial".
func countingListener(t *testing.T) (port int, connects *atomic.Int64) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	connects = &atomic.Int64{}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			connects.Add(1)
			_ = conn.Close()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, connects
}

// @scenario "the viewer keeps its event loop free for the keyboard"
func TestLiveness(t *testing.T) {
	t.Run("when the same port is asked about on every frame", func(t *testing.T) {
		port, connects := countingListener(t)
		api := newEndpoint(port)

		if !api.up() {
			t.Fatal("a listening port reads as down")
		}
		for range 200 {
			if !api.up() {
				t.Fatal("a listening port reads as down on a later ask")
			}
		}

		// One connect, not 201: the log tab's footer asks on every rendered
		// frame, and a frame is drawn for every keystroke.
		deadline := time.Now().Add(time.Second)
		for connects.Load() == 0 && time.Now().Before(deadline) {
			time.Sleep(time.Millisecond)
		}
		if got := connects.Load(); got != 1 {
			t.Fatalf("dialled %d times for 201 asks, want 1", got)
		}
	})

	t.Run("when the answer has gone stale", func(t *testing.T) {
		port, connects := countingListener(t)
		l := &liveness{port: port}

		if !l.alive() {
			t.Fatal("a listening port reads as down")
		}
		l.mu.Lock()
		l.at = time.Now().Add(-2 * livenessTTL)
		l.mu.Unlock()

		// The stale ask is still answered from the cache - it must not wait for
		// the dial it just started.
		if !l.alive() {
			t.Fatal("a stale answer was not reported while it refreshed")
		}
		deadline := time.Now().Add(2 * time.Second)
		for connects.Load() < 2 && time.Now().Before(deadline) {
			time.Sleep(time.Millisecond)
		}
		if got := connects.Load(); got != 2 {
			t.Fatalf("a stale answer was re-dialled %d times, want 2 total", got)
		}
	})

	t.Run("when nothing is listening", func(t *testing.T) {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		port := ln.Addr().(*net.TCPAddr).Port
		_ = ln.Close()

		if newEndpoint(port).up() {
			t.Fatal("a closed port reads as up")
		}
	})
}
