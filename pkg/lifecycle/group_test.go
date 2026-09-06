package lifecycle

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
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

func nopCtx() context.Context { return clog.Set(context.Background(), zap.NewNop()) }

func TestGroup_starts_and_stops_in_order(t *testing.T) {
	rec := &recorder{}
	g := New(WithDrainDelay(0))
	g.Add(rec.worker("a"), rec.worker("b"), rec.worker("c"))

	ctx, cancel := context.WithCancel(nopCtx())
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

	g := New(WithDrainDelay(0))
	g.Add(rec.worker("a"), fail, rec.worker("c"))

	err := g.Run(nopCtx())
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

	g := New(WithDrainDelay(0), WithHealth(h))
	g.Add(Worker("x", func(context.Context) {}, func() {}))

	ctx, cancel := context.WithCancel(nopCtx())
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

	g := New(WithDrainDelay(delay))
	g.Add(rec.worker("a"))

	ctx, cancel := context.WithCancel(nopCtx())

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

	g := New(WithDrainDelay(0))
	g.Add(rec.worker("bg"), fatal)

	go func() {
		time.Sleep(50 * time.Millisecond)
		fatal.fatalCh <- boom
	}()

	err := g.Run(nopCtx())
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

	g := New(WithGraceful(100*time.Millisecond), WithDrainDelay(0))
	g.Add(slowStop)

	ctx, cancel := context.WithCancel(nopCtx())
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

// The drain delay is time spent making the pod unroutable, so it must be
// charged on top of the graceful budget rather than out of it. A service's
// Stop has to see the full configured budget however long the drain took,
// or the number an operator configures is not the number a request gets.
func TestGroup_graceful_budget_is_not_consumed_by_the_drain_delay(t *testing.T) {
	const (
		graceful   = 300 * time.Millisecond
		drainDelay = 200 * time.Millisecond
	)

	var (
		stopCalledAt time.Time
		deadline     time.Time
		hadDeadline  bool
	)
	probe := &mockSvc{
		name:    "probe",
		startFn: func(context.Context) error { return nil },
		stopFn: func(ctx context.Context) error {
			stopCalledAt = time.Now()
			deadline, hadDeadline = ctx.Deadline()
			return nil
		},
	}

	g := New(WithGraceful(graceful), WithDrainDelay(drainDelay))
	g.Add(probe)

	ctx, cancel := context.WithCancel(nopCtx())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	if err := g.Run(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !hadDeadline {
		t.Fatal("Stop received a context with no deadline, so the graceful budget is unbounded")
	}

	// The drain really happened before the stop, so this cannot pass by
	// skipping the wait the budget is supposed to exclude.
	if waited := stopCalledAt.Sub(start); waited < drainDelay {
		t.Errorf("stop ran %v after the signal, expected at least the %v drain delay", waited, drainDelay)
	}

	// Scheduling slack only. Before the fix this budget was
	// graceful-minus-drainDelay, so 100ms rather than 300ms.
	const slack = 60 * time.Millisecond
	if budget := deadline.Sub(stopCalledAt); budget < graceful-slack {
		t.Errorf("stop got a %v budget, want the full configured %v", budget, graceful)
	}
}

func TestGroup_ServiceNames_reports_start_order(t *testing.T) {
	rec := &recorder{}
	g := New()
	g.Add(rec.worker("a"), rec.worker("b"))
	g.Add(rec.worker("c"))

	want := []string{"a", "b", "c"}
	got := g.ServiceNames()
	if len(got) != len(want) {
		t.Fatalf("names = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("name[%d] = %q, want %q", i, got[i], want[i])
		}
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
