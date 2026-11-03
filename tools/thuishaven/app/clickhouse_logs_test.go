package app

import (
	"testing"

	"go.uber.org/zap"
)

// fakeLogCappedClickHouse is a fakeDBServer whose server writes an unrotated log.
type fakeLogCappedClickHouse struct {
	fakeDBServer
	capped int
}

func (f *fakeLogCappedClickHouse) CapLogs() { f.capped++ }

// @scenario "The daemon caps the managed server's logs"
func TestCapClickHouseLogs(t *testing.T) {
	t.Run("given haven manages the clickhouse, when the daemon caps logs, then the adapter caps them", func(t *testing.T) {
		ch := &fakeLogCappedClickHouse{}
		o := &Orchestrator{cfg: Config{ShouldManageClickHouse: true}, ch: ch, log: zap.NewNop()}
		o.capClickHouseLogs()
		if ch.capped != 1 {
			t.Fatalf("CapLogs called %d times, want 1", ch.capped)
		}
	})
	t.Run("given haven does not manage the clickhouse, when the daemon caps logs, then it is left alone", func(t *testing.T) {
		ch := &fakeLogCappedClickHouse{}
		o := &Orchestrator{cfg: Config{ShouldManageClickHouse: false}, ch: ch, log: zap.NewNop()}
		o.capClickHouseLogs()
		if ch.capped != 0 {
			t.Fatalf("CapLogs called %d times, want 0", ch.capped)
		}
	})
	t.Run("given an adapter that cannot cap logs, when the daemon caps logs, then nothing happens", func(t *testing.T) {
		o := &Orchestrator{cfg: Config{ShouldManageClickHouse: true}, ch: &fakeDBServer{}, log: zap.NewNop()}
		o.capClickHouseLogs()
	})
	t.Run("given no clickhouse, when the daemon caps logs, then nothing happens", func(t *testing.T) {
		o := &Orchestrator{cfg: Config{ShouldManageClickHouse: true}, log: zap.NewNop()}
		o.capClickHouseLogs()
	})
}
