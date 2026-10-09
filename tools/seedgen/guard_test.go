package seedgen

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// @scenario "The seed backs off when ClickHouse nears its memory limit"
func TestClickHouseMemoryHalvesThenPausesUntilBelowSixtyPercent(t *testing.T) {
	var log strings.Builder
	guard, now := NewGuard(&log), time.Now()
	guard.Observe(now, []Reading{{SignalClickHouseMemory, 0.72}})
	if guard.Window != 2 || !strings.Contains(log.String(), "clickhouse_memory=0.72") {
		t.Fatalf("70%% should halve 4 to 2 and log the signal; window %d, log %q", guard.Window, log.String())
	}
	guard.Observe(now, []Reading{{SignalClickHouseMemory, 0.86}})
	if guard.Paused == nil {
		t.Fatal("above 85% sending should pause")
	}
	guard.Observe(now, []Reading{{SignalClickHouseMemory, 0.65}})
	if guard.Paused == nil {
		t.Fatal("65% is not below the 60% resume line")
	}
	guard.Observe(now, []Reading{{SignalClickHouseMemory, 0.55}})
	if guard.Paused != nil {
		t.Fatal("below 60% sending should resume")
	}
}

// @scenario "The seed backs off when the worker falls behind"
func TestWorkerBacklogHalvesAndPausesUntilBelowTenThousand(t *testing.T) {
	guard, now := NewGuard(nil), time.Now()
	guard.Observe(now, []Reading{{SignalWorkerBacklog, 25_000}})
	if guard.Window != 2 {
		t.Fatalf("window %d, want 2", guard.Window)
	}
	guard.Observe(now, []Reading{{SignalWorkerBacklog, 60_000}})
	guard.Observe(now, []Reading{{SignalWorkerBacklog, 12_000}})
	if guard.Paused == nil {
		t.Fatal("12,000 jobs is not below the 10,000 resume line")
	}
	guard.Observe(now, []Reading{{SignalWorkerBacklog, 9_000}})
	if guard.Paused != nil {
		t.Fatal("below 10,000 sending should resume")
	}
}

// @scenario "The seed backs off on too many ClickHouse parts, Redis memory or host memory pressure"
func TestPartsRedisAndHostPressureHalveOrPause(t *testing.T) {
	for _, c := range []struct{ halve, pause Reading }{
		{Reading{SignalClickHouseParts, 160}, Reading{SignalClickHouseParts, 320}},
		{Reading{SignalRedisMemory, 0.75}, Reading{SignalRedisMemory, 0.9}},
		{Reading{SignalHostPressure, 1}, Reading{SignalHostPressure, 2}},
	} {
		guard := NewGuard(nil)
		guard.Observe(time.Now(), []Reading{c.halve})
		if guard.Window != 2 || guard.Paused != nil {
			t.Errorf("%s: window %d paused %v, want halved", c.halve, guard.Window, guard.Paused)
		}
		guard.Observe(time.Now(), []Reading{c.pause})
		if guard.Paused == nil || guard.Paused.Signal != c.pause.Signal {
			t.Errorf("%s should pause", c.pause)
		}
	}
}

func TestCleanReadsGrowTheWindowToItsCeiling(t *testing.T) {
	guard := NewGuard(nil)
	for range 3 * 40 {
		guard.Observe(time.Now(), []Reading{{SignalClickHouseMemory, 0.1}})
	}
	if guard.Window != WindowCeil {
		t.Fatalf("window %d, want %d", guard.Window, WindowCeil)
	}
}

// fakeExecutor acks every action, or refuses as retryable while the gate is shut.
type fakeExecutor struct {
	mu   sync.Mutex
	sent map[string]int
}

func (f *fakeExecutor) Send(_ context.Context, action Action) (Reply, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent[action.ID]++
	reply := Reply{ID: action.ID, OK: true}
	if action.Ref != "" {
		reply.Refs = map[string]string{action.Ref: "id-" + action.Ref}
	}
	return reply, nil
}

func (f *fakeExecutor) Close() error { return nil }

// @scenario "A seed that stays paused stops with a checkpoint and resumes later"
func TestAStalledRunCheckpointsAndResumesWithoutResending(t *testing.T) {
	plan, err := NewPlan(Flags{Size: "tiny", Spans: 40, Days: 1, Personas: []string{"startup"}, Private: 0,
		Seed: 7, Anchor: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), Shape: "saas"})
	if err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/run.json"
	clock := time.Now()
	var mu sync.Mutex
	pressure := 0.1
	sensor := Sensor{Name: "clickhouse", Read: func(context.Context) ([]Reading, error) {
		mu.Lock()
		defer mu.Unlock()
		return []Reading{{SignalClickHouseMemory, pressure}}, nil
	}}
	now := func() time.Time { mu.Lock(); defer mu.Unlock(); clock = clock.Add(time.Minute); return clock }
	executor := &fakeExecutor{sent: map[string]int{}}
	stalling := &pressureExecutor{fakeExecutor: executor, trip: func() { mu.Lock(); pressure = 0.9; mu.Unlock() }}
	_, err = Run(context.Background(), RunConfig{Plan: plan, Executor: stalling, Sensors: []Sensor{sensor},
		Checkpoint: NewCheckpoint(plan.Run, nil), Path: path, Tick: time.Millisecond, Now: now})
	var stall *StallError
	if !errors.As(err, &stall) || stall.Reading.Signal != SignalClickHouseMemory {
		t.Fatalf("want a stall naming clickhouse_memory, got %v", err)
	}
	checkpoint, err := LoadCheckpoint(path, plan.Run)
	if err != nil || checkpoint.Cursor == 0 {
		t.Fatalf("checkpoint %+v, %v: want the acked steps saved", checkpoint, err)
	}
	mu.Lock()
	pressure = 0.1
	mu.Unlock()
	result, err := Run(context.Background(), RunConfig{Plan: plan, Executor: executor, Sensors: []Sensor{sensor},
		Checkpoint: checkpoint, Path: path, Tick: time.Millisecond, Now: now})
	if err != nil || result.Spans != 40 {
		t.Fatalf("resume: %v, %d spans; want every span sent once the pause lifts", err, result.Spans)
	}
	for id, n := range executor.sent {
		if n > 1 {
			t.Errorf("%s sent %d times", id, n)
		}
	}
}

// pressureExecutor acks the first action and trips the pressure; later sends hang until cancelled.
type pressureExecutor struct {
	*fakeExecutor
	trip    func()
	tripped sync.Once
	first   atomic.Bool
}

func (p *pressureExecutor) Send(ctx context.Context, action Action) (Reply, error) {
	if p.first.CompareAndSwap(false, true) {
		defer p.tripped.Do(p.trip)
		return p.fakeExecutor.Send(ctx, action)
	}
	<-ctx.Done()
	return Reply{}, ctx.Err()
}

func TestTaskPipeSkipsLogLinesAndKeepsReplies(t *testing.T) {
	if _, ok := parseReply([]byte(`{"level":30,"msg":"task starting"}`)); ok {
		t.Error("a pino line is not a reply")
	}
	if _, ok := parseReply([]byte(`> @langwatch/tasks task`)); ok {
		t.Error("a pnpm header is not a reply")
	}
	if reply, ok := parseReply([]byte(`{"id":"r/1","ok":false,"code":"unknown_seed_kind"}`)); !ok || reply.Code != "unknown_seed_kind" {
		t.Error("a refusal is a reply")
	}
}
