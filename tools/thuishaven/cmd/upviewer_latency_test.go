package cmd

import (
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// Bubble Tea delivers one message at a time on one goroutine, and that
// goroutine is the one reading the keyboard. Anything Update does before it
// returns, the reader's next keystroke waits for - and the live probe behind
// the session dashboard forks `ps` over the whole machine and dials a port per
// service. These are the tests that keep it off that goroutine.

// probeSpy is a snapshot function that records which goroutine asked and how
// long it was made to take.
type probeSpy struct {
	calls  int
	delay  time.Duration
	report app.SessionReport
}

func (p *probeSpy) snapshot() app.SessionReport {
	p.calls++
	time.Sleep(p.delay)
	return p.report
}

func latencyModel(t *testing.T, spy *probeSpy) *viewerModel {
	t.Helper()
	m := dashModel(t, []app.SessionServiceStatus{{Name: "ui", Port: 5560, Up: true}}, nil)
	m.session.Snapshot = spy.snapshot
	spy.calls = 0
	return m
}

// @scenario "the viewer keeps its event loop free for the keyboard"
func TestTickDoesNotProbeOnTheEventLoop(t *testing.T) {
	t.Run("when the slow beat comes round", func(t *testing.T) {
		spy := &probeSpy{delay: 300 * time.Millisecond, report: app.SessionReport{Found: true, Slug: "feat-x"}}
		m := latencyModel(t, spy)

		var cmd tea.Cmd
		start := time.Now()
		for range 4 { // the snapshot is on every fourth 300ms tick
			_, cmd = m.Update(viewerTickMsg{})
		}
		elapsed := time.Since(start)

		if spy.calls != 0 {
			t.Fatalf("the probe ran inside Update %d times", spy.calls)
		}
		if elapsed > 100*time.Millisecond {
			t.Fatalf("four ticks held the event loop for %s", elapsed)
		}
		if cmd == nil {
			t.Fatal("the fourth tick asked for no snapshot")
		}

		// The command is what pays for the probe, off the loop, and the answer
		// comes back as a message like any other.
		msg := cmd()
		batch, isBatch := msg.(tea.BatchMsg)
		if !isBatch {
			t.Fatalf("the tick returned %T, want a batch of the next tick and the probe", msg)
		}
		var snap snapshotMsg
		for _, c := range batch {
			if got, ok := c().(snapshotMsg); ok {
				snap = got
			}
		}
		if snap.report.Slug != "feat-x" {
			t.Fatalf("the probe delivered %+v", snap.report)
		}
		if _, _ = m.Update(snap); m.snap.Slug != "feat-x" {
			t.Fatalf("the dashboard kept %+v after the probe answered", m.snap)
		}
	})

	t.Run("when a probe is still out", func(t *testing.T) {
		spy := &probeSpy{report: app.SessionReport{Found: true}}
		m := latencyModel(t, spy)

		if cmd := m.probeSnapshot(); cmd == nil {
			t.Fatal("the first probe was refused")
		}
		if cmd := m.probeSnapshot(); cmd != nil {
			t.Fatal("a second probe was queued behind the one in flight")
		}
		m.Update(snapshotMsg{report: spy.report})
		if cmd := m.probeSnapshot(); cmd == nil {
			t.Fatal("no probe was allowed after the first answered")
		}
	})

	t.Run("when the stores tab polls twice inside one beat", func(t *testing.T) {
		m := latencyModel(t, &probeSpy{})
		stores := &sessionStores{model: m} // no servers named, so the probe forks nothing

		if _, err := stores.Stats(); err != nil {
			t.Fatalf("first probe: %v", err)
		}
		first := stores.at
		if first.IsZero() {
			t.Fatal("the first ask did not probe")
		}
		for range 10 {
			if _, err := stores.Stats(); err != nil {
				t.Fatalf("later probe: %v", err)
			}
		}
		if stores.at != first {
			t.Fatal("a fresh reading was probed again inside its own beat")
		}

		stores.at = time.Now().Add(-2 * storesTTL)
		if _, err := stores.Stats(); err != nil {
			t.Fatalf("stale probe: %v", err)
		}
		deadline := time.Now().Add(time.Second)
		for time.Now().Before(deadline) {
			stores.mu.Lock()
			refreshed := time.Since(stores.at) < storesTTL
			stores.mu.Unlock()
			if refreshed {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("a stale reading was never refreshed")
	})

	t.Run("when a key arrives during the beat", func(t *testing.T) {
		spy := &probeSpy{delay: 300 * time.Millisecond, report: app.SessionReport{Found: true}}
		m := latencyModel(t, spy)
		for range 4 {
			m.Update(viewerTickMsg{})
		}

		start := time.Now()
		m.Update(key("right"))
		if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
			t.Fatalf("a keypress took %s to be handled", elapsed)
		}
		if m.currentTab() != "logs" {
			t.Fatalf("the key moved to %q", m.currentTab())
		}
	})
}
