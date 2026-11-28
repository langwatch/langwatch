package app

import (
	"errors"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// fakeLogCappedClickHouse is a fakeDBServer whose server writes an unrotated log.
type fakeLogCappedClickHouse struct {
	fakeDBServer
	emptied int64
	err     error
	capped  int
}

func (f *fakeLogCappedClickHouse) CapLogs() (int64, error) {
	f.capped++
	return f.emptied, f.err
}

func logCapOrch(ch ClickHouse, managed bool) (*Orchestrator, *observer.ObservedLogs) {
	core, logs := observer.New(zapcore.InfoLevel)
	return &Orchestrator{
		cfg:   Config{ShouldManageClickHouse: managed},
		ch:    ch,
		sys:   &fakeSystem{},
		store: &fakeStore{},
		log:   zap.New(core),
	}, logs
}

// @scenario "The daemon caps the managed server's logs"
func TestCapClickHouseLogs(t *testing.T) {
	t.Run("given haven manages the clickhouse and its log is past the cap, when the daemon caps logs, then the emptying is recorded and logged", func(t *testing.T) {
		ch := &fakeLogCappedClickHouse{emptied: 3 << 30}
		o, logs := logCapOrch(ch, true)
		o.capClickHouseLogs()
		if ch.capped != 1 {
			t.Fatalf("CapLogs called %d times, want 1", ch.capped)
		}
		events := o.store.ReapEvents()
		if len(events) != 1 || events[0].Kind != "clickhouse" || events[0].Target != "stdout.log" {
			t.Fatalf("recorded reaps = %+v, want one for clickhouse stdout.log", events)
		}
		if want := domain.HumanBytes(3<<30) + " past its cap"; events[0].Reason != want {
			t.Errorf("reason = %q, want %q", events[0].Reason, want)
		}
		if logs.FilterMessage("emptied oversized clickhouse stdout.log").Len() != 1 {
			t.Errorf("want the emptying logged, got %v", logs.All())
		}
	})
	t.Run("given haven manages the clickhouse and its log is under the cap, when the daemon caps logs, then nothing is recorded", func(t *testing.T) {
		ch := &fakeLogCappedClickHouse{}
		o, logs := logCapOrch(ch, true)
		o.capClickHouseLogs()
		if ch.capped != 1 {
			t.Fatalf("CapLogs called %d times, want 1", ch.capped)
		}
		if n := len(o.store.ReapEvents()); n != 0 || logs.Len() != 0 {
			t.Fatalf("got %d reaps and %d log lines, want none", n, logs.Len())
		}
	})
	t.Run("given an adapter that cannot cap logs, when the daemon caps logs, then nothing happens", func(t *testing.T) {
		o, _ := logCapOrch(&fakeDBServer{}, true)
		o.capClickHouseLogs()
	})
	t.Run("given no clickhouse, when the daemon caps logs, then nothing happens", func(t *testing.T) {
		o, _ := logCapOrch(nil, true)
		o.capClickHouseLogs()
	})
}

// @scenario "The daemon leaves an unmanaged ClickHouse's logs alone"
func TestCapClickHouseLogsLeavesAnUnmanagedClickHouseAlone(t *testing.T) {
	ch := &fakeLogCappedClickHouse{emptied: 3 << 30}
	o, _ := logCapOrch(ch, false)
	o.capClickHouseLogs()
	if ch.capped != 0 {
		t.Fatalf("CapLogs called %d times, want 0", ch.capped)
	}
}

// @scenario "The daemon warns when it cannot cap the logs"
func TestCapClickHouseLogsWarnsOnAFailedCap(t *testing.T) {
	ch := &fakeLogCappedClickHouse{err: errors.New("permission denied")}
	o, logs := logCapOrch(ch, true)
	o.capClickHouseLogs()
	warned := logs.FilterMessage("could not cap clickhouse stdout.log").All()
	if len(warned) != 1 || warned[0].Level != zapcore.WarnLevel {
		t.Fatalf("want one warning, got %v", logs.All())
	}
	if n := len(o.store.ReapEvents()); n != 0 {
		t.Fatalf("a failed cap recorded %d reaps, want none", n)
	}
}
