package lifecycle

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
)

// recorder tracks start/stop calls in order.
type recorder struct {
	mu     sync.Mutex
	events []string
}

func (r *recorder) record(s string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, s)
}

func (r *recorder) get() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.events))
	copy(out, r.events)
	return out
}

func (r *recorder) worker(name string) Service {
	return Worker(name, func(context.Context) {
		r.record("start:" + name)
	}, func() {
		r.record("stop:" + name)
	})
}

func nopLogger() *zap.Logger { return zap.NewNop() }

func TestGroup_starts_and_stops_in_order(t *testing.T) {
	rec := &recorder{}
	g := New(nopLogger(), WithDrainDelay(0))
	g.Add(rec.worker("a"), rec.worker("b"), rec.worker("c"))

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	if err := g.Run(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := []string{
		"start:a", "start:b", "start:c",
		"stop:c", "stop:b", "stop:a",
	}
	got := rec.get()
	if len(got) != len(want) {
		t.Fatalf("events = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("event[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestGroup_start_failure_stops_already_started(t *testing.T) {
	rec := &recorder{}

	fail := &mockSvc{
		name: "fail",
		startFn: func(context.Context) error {
			return errors.New("boom")
		},
		stopFn: func(context.Context) error { return nil },
	}

	g := New(nopLogger(), WithDrainDelay(0))
	g.Add(rec.worker("a"), fail, rec.worker("c"))

	err := g.Run(context.Background())
	if err == nil {
		t.Fatal("expected error")
	}
	if got := err.Error(); got != "start fail: boom" {
		t.Errorf("error = %q, want %q", got, "start fail: boom")
	}

	got := rec.get()
	// "a" started, "fail" failed before "c" could start, so only "a" is stopped.
	want := []string{"start:a", "stop:a"}
	if len(got) != len(want) {
		t.Fatalf("events = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("event[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestGroup_marks_health_draining(t *testing.T) {
	h := health.New("test")
	h.MarkStarted()

	g := New(nopLogger(), WithDrainDelay(0), WithHealth(h))
	g.Add(Worker("x", func(context.Context) {}, func() {}))

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	_ = g.Run(ctx)

	if !h.Draining() {
		t.Error("health should be draining after shutdown")
	}
}

func TestGroup_drain_delay_pauses_before_stop(t *testing.T) {
	rec := &recorder{}
	delay := 100 * time.Millisecond

	g := New(nopLogger(), WithDrainDelay(delay))
	g.Add(rec.worker("a"))

	ctx, cancel := context.WithCancel(context.Background())

	start := time.Now()
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	_ = g.Run(ctx)
	elapsed := time.Since(start)

	// Shutdown should have waited at least the drain delay.
	if elapsed < delay {
		t.Errorf("shutdown took %v, expected at least %v drain delay", elapsed, delay)
	}
}

func TestGroup_fatal_error_triggers_shutdown(t *testing.T) {
	rec := &recorder{}
	boom := errors.New("listener crashed")

	fatal := &fatalSvc{
		name:    "http",
		fatalCh: make(chan error, 1),
	}

	g := New(nopLogger(), WithDrainDelay(0))
	g.Add(rec.worker("bg"), fatal)

	go func() {
		time.Sleep(50 * time.Millisecond)
		fatal.fatalCh <- boom
	}()

	err := g.Run(context.Background())
	if !errors.Is(err, boom) {
		t.Errorf("error = %v, want %v", err, boom)
	}

	got := rec.get()
	// "bg" should be stopped during shutdown.
	if len(got) < 2 || got[len(got)-1] != "stop:bg" {
		t.Errorf("events = %v, expected stop:bg", got)
	}
}

func TestGroup_graceful_timeout_enforced(t *testing.T) {
	slowStop := &mockSvc{
		name:    "slow",
		startFn: func(context.Context) error { return nil },
		stopFn: func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}

	g := New(nopLogger(), WithGraceful(100*time.Millisecond), WithDrainDelay(0))
	g.Add(slowStop)

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	err := g.Run(ctx)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected timeout error")
	}
	// Should complete within graceful timeout + small margin.
	if elapsed > 300*time.Millisecond {
		t.Errorf("shutdown took %v, graceful timeout is 100ms", elapsed)
	}
}

// --- test helpers ---

type mockSvc struct {
	name    string
	startFn func(context.Context) error
	stopFn  func(context.Context) error
}

func (m *mockSvc) String() string                  { return m.name }
func (m *mockSvc) Start(ctx context.Context) error { return m.startFn(ctx) }
func (m *mockSvc) Stop(ctx context.Context) error  { return m.stopFn(ctx) }

type fatalSvc struct {
	name    string
	fatalCh chan error
}

func (f *fatalSvc) String() string              { return f.name }
func (f *fatalSvc) Start(context.Context) error { return nil }
func (f *fatalSvc) Stop(context.Context) error  { return nil }
func (f *fatalSvc) Fatal() <-chan error         { return f.fatalCh }
