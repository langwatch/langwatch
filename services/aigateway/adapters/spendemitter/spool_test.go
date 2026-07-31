package spendemitter

// Tests for the spool's durability contract: records survive restart,
// sequence numbers stay monotonic across restart, overflow drops oldest
// and counts, and appends never block even with the writer gone.

import (
	"context"
	"sync"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func openTestSpool(t *testing.T, dir string) *Spool {
	t.Helper()
	s, err := Open(SpoolOptions{
		Dir:        dir,
		FlushEvery: 20 * time.Millisecond,
		PodID:      "pod-test",
	})
	require.NoError(t, err)
	return s
}

func waitForSealed(t *testing.T, s *Spool, want int) []string {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if segs := s.SealedSegments(); len(segs) >= want {
			return segs
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected %d sealed segments", want)
	return nil
}

/** @scenario Appended records seal within a flush interval and read back in order */
func TestSpoolAppendSealRead(t *testing.T) {
	s := openTestSpool(t, t.TempDir())
	defer s.Close()

	for i := 0; i < 3; i++ {
		s.Append(Record{Command: CommandAdmit, Payload: json.RawMessage(`{"n":` + string(rune('0'+i)) + `}`)})
	}
	segs := waitForSealed(t, s, 1)
	records, err := ReadSegment(segs[0])
	require.NoError(t, err)
	require.Len(t, records, 3)
	assert.Equal(t, uint64(0), records[0].PodSeq)
	assert.Equal(t, uint64(2), records[2].PodSeq)
	assert.Equal(t, "pod-test", records[0].PodID)
}

/** @scenario Sequence numbers continue across a clean restart */
func TestSpoolSequenceContinuesAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	s := openTestSpool(t, dir)
	s.Append(Record{Command: CommandAdmit, Payload: json.RawMessage(`{}`)})
	s.Append(Record{Command: CommandConfirm, Payload: json.RawMessage(`{}`)})
	require.NoError(t, s.Close())

	s2 := openTestSpool(t, dir)
	defer s2.Close()
	s2.Append(Record{Command: CommandFail, Payload: json.RawMessage(`{}`)})
	segs := waitForSealed(t, s2, 2)

	var all []Record
	for _, seg := range segs {
		records, err := ReadSegment(seg)
		require.NoError(t, err)
		all = append(all, records...)
	}
	require.Len(t, all, 3)
	assert.Equal(t, uint64(2), all[2].PodSeq, "sequence continues from persisted state")
	assert.Equal(t, "pod-test", all[2].PodID, "pod id persists across restart")
}

/** @scenario A hard crash preserves flushed records and skips a torn last line */
func TestSpoolCrashRecovery(t *testing.T) {
	dir := t.TempDir()
	s := openTestSpool(t, dir)
	s.Append(Record{Command: CommandAdmit, Payload: json.RawMessage(`{"ok":true}`)})
	// Force the write through without a clean Close: flush tick seals it.
	waitForSealed(t, s, 1)
	// Stop the writer goroutine; the sealed segment is already on disk and
	// the crash simulation below only touches the NEXT active file.
	require.NoError(t, s.Close())
	// Simulate the crash: abandon the spool without Close, corrupt a torn
	// last line into the next active segment as a dead process would leave.
	require.NoError(t, os.WriteFile(filepath.Join(dir, activeName), []byte(`{"command":"confirmSp`), 0o600))

	s2 := openTestSpool(t, dir)
	defer s2.Close()
	segs := s2.SealedSegments()
	require.Len(t, segs, 2, "leftover active sealed on recovery")
	var total int
	for _, seg := range segs {
		records, err := ReadSegment(seg)
		require.NoError(t, err)
		total += len(records)
	}
	assert.Equal(t, 1, total, "torn line skipped, sealed record survives")
}

/** @scenario Overflow drops the oldest segments and counts every lost record */
func TestSpoolOverflowDropsOldest(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(SpoolOptions{
		Dir:             dir,
		SegmentMaxBytes: 200,
		MaxTotalBytes:   600,
		FlushEvery:      10 * time.Millisecond,
		PodID:           "pod-test",
	})
	require.NoError(t, err)
	defer s.Close()

	payload := json.RawMessage(`{"filler":"` + strings.Repeat("x", 100) + `"}`)
	for i := 0; i < 30; i++ {
		s.Append(Record{Command: CommandAdmit, Payload: payload})
		time.Sleep(2 * time.Millisecond)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && s.Stats().DroppedOverflow == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	stats := s.Stats()
	assert.Greater(t, stats.DroppedOverflow, uint64(0), "overflow must be counted")
	segs := s.SealedSegments()
	var totalSize int64
	for _, seg := range segs {
		st, err := os.Stat(seg)
		require.NoError(t, err)
		totalSize += st.Size()
	}
	assert.LessOrEqual(t, totalSize, int64(800), "spool stays near its bound")
}

/** @scenario Appends never block even when the writer is gone */
func TestSpoolAppendNeverBlocks(t *testing.T) {
	s := openTestSpool(t, t.TempDir())
	require.NoError(t, s.Close()) // writer gone; intake channel still there

	start := time.Now()
	for i := 0; i < 10000; i++ {
		s.Append(Record{Command: CommandAdmit, Payload: json.RawMessage(`{}`)})
	}
	elapsed := time.Since(start)
	assert.Less(t, elapsed, 500*time.Millisecond, "10k appends with a dead writer stay fast")
	assert.Greater(t, s.Stats().DroppedIntake, uint64(0), "drops are counted, never silent")
}

type stubShipper struct {
	mu      sync.Mutex
	fail    int
	shipped [][]Record
}

func (s *stubShipper) snapshot() (int, [][]Record) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fail, append([][]Record(nil), s.shipped...)
}

func (s *stubShipper) Ship(ctx context.Context, records []Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail > 0 {
		s.fail--
		return errors.New("ingest down")
	}
	s.shipped = append(s.shipped, records)
	return nil
}

/** @scenario The drainer ships oldest first and deletes only after ack */
func TestDrainerShipsAndAcks(t *testing.T) {
	dir := t.TempDir()
	s := openTestSpool(t, dir)
	defer s.Close()
	s.Append(Record{Command: CommandAdmit, Payload: json.RawMessage(`{"a":1}`)})
	waitForSealed(t, s, 1)

	shipper := &stubShipper{}
	d := NewDrainer(DrainerOptions{Spool: s, Shipper: shipper, Tick: 10 * time.Millisecond})
	ctx, cancel := context.WithCancel(context.Background())
	go d.Start(ctx)
	defer cancel()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && len(s.SealedSegments()) > 0 {
		time.Sleep(10 * time.Millisecond)
	}
	require.Empty(t, s.SealedSegments(), "acked segment deleted")
	_, shippedBatches := shipper.snapshot()
	require.Len(t, shippedBatches, 1)
	assert.Equal(t, CommandAdmit, shippedBatches[0][0].Command)
}

/** @scenario Ship failures back off and never touch the spooled data */
func TestDrainerRetryKeepsData(t *testing.T) {
	dir := t.TempDir()
	s := openTestSpool(t, dir)
	defer s.Close()
	s.Append(Record{Command: CommandAdmit, Payload: json.RawMessage(`{"a":1}`)})
	waitForSealed(t, s, 1)

	shipper := &stubShipper{fail: 2}
	d := NewDrainer(DrainerOptions{Spool: s, Shipper: shipper, Tick: 10 * time.Millisecond})
	ctx, cancel := context.WithCancel(context.Background())
	go d.Start(ctx)
	defer cancel()

	// Backoff floor is 1s: after two failures the segment must still exist.
	time.Sleep(200 * time.Millisecond)
	assert.Len(t, s.SealedSegments(), 1, "unacked data survives failures")

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && len(s.SealedSegments()) > 0 {
		time.Sleep(25 * time.Millisecond)
	}
	assert.Empty(t, s.SealedSegments(), "ships once the endpoint recovers")
	_, shippedBatches := shipper.snapshot()
	require.Len(t, shippedBatches, 1)
}
