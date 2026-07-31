package spendemitter

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Spool is a bounded, segmented, on-disk queue of spend records.
//
// Writes: Append never blocks the caller beyond a channel send that drops
// (counted) when the writer is stuck. A single writer goroutine assigns
// pod sequence numbers, appends NDJSON to the active segment through a
// buffered writer, rotates the segment at segmentMaxBytes, and fsyncs on a
// timer, never on the request path. A non-empty active segment is sealed on
// the flush tick, so records become drainable within one flush interval.
//
// Bounds: when the spool exceeds maxTotalBytes the OLDEST sealed segments
// are deleted first (their record count is added to DroppedOverflow); the
// newest data always survives. When the intake channel is full the record
// is dropped at intake (DroppedIntake). Every drop is visible: the counters
// move and the per-pod sequence stream keeps a hole where the record was.
//
// Restart: Open seals a leftover active segment from a previous process,
// recovers the highest persisted sequence number, and continues from it.
// The pod id persists in a pod-id file beside the segments, so a restart
// with an intact disk keeps both identity and sequence continuity.
type Spool struct {
	dir             string
	segmentMaxBytes int64
	maxTotalBytes   int64
	flushEvery      time.Duration

	intake chan Record
	podID  string

	mu         sync.Mutex // guards active segment state + dir mutations
	active     *os.File
	activeBuf  *bufio.Writer
	activeSize int64
	nextSeq    uint64 // next pod_seq to assign (writer goroutine only)
	segCounter uint64 // strictly increasing segment file ordinal

	droppedIntake   atomic.Uint64
	droppedOverflow atomic.Uint64
	appended        atomic.Uint64

	done   chan struct{}
	closed atomic.Bool
	wg     sync.WaitGroup

	logf func(format string, args ...any)

	lastDropLog atomic.Int64
}

// SpoolOptions configures Open.
type SpoolOptions struct {
	Dir             string
	SegmentMaxBytes int64         // default 1 MiB
	MaxTotalBytes   int64         // default 64 MiB
	FlushEvery      time.Duration // default 1s
	IntakeBuffer    int           // default 4096
	// PodID overrides the persisted pod identity (the deployment's node id).
	// Empty: hostname plus a random nonce, persisted in the spool dir.
	PodID string
	// Logf receives rate-limited operational messages. Nil discards.
	Logf func(format string, args ...any)
}

const (
	segPrefix  = "seg-"
	segSuffix  = ".ndjson"
	activeName = "active.ndjson"
	podIDFile  = "pod-id"
)

// Open initializes the spool directory, recovers state from a previous
// process, and starts the writer goroutine.
func Open(opts SpoolOptions) (*Spool, error) {
	if opts.Dir == "" {
		return nil, fmt.Errorf("spendemitter: spool dir required")
	}
	if err := os.MkdirAll(opts.Dir, 0o700); err != nil {
		return nil, fmt.Errorf("spendemitter: create spool dir: %w", err)
	}
	if opts.SegmentMaxBytes <= 0 {
		opts.SegmentMaxBytes = 1 << 20
	}
	if opts.MaxTotalBytes <= 0 {
		opts.MaxTotalBytes = 64 << 20
	}
	if opts.FlushEvery <= 0 {
		opts.FlushEvery = time.Second
	}
	if opts.IntakeBuffer <= 0 {
		opts.IntakeBuffer = 4096
	}
	if opts.Logf == nil {
		opts.Logf = func(string, ...any) {}
	}

	s := &Spool{
		dir:             opts.Dir,
		segmentMaxBytes: opts.SegmentMaxBytes,
		maxTotalBytes:   opts.MaxTotalBytes,
		flushEvery:      opts.FlushEvery,
		intake:          make(chan Record, opts.IntakeBuffer),
		done:            make(chan struct{}),
		logf:            opts.Logf,
	}

	podID, err := s.loadOrCreatePodID(opts.PodID)
	if err != nil {
		return nil, err
	}
	s.podID = podID

	if err := s.recover(); err != nil {
		return nil, err
	}

	s.wg.Add(1)
	go s.writerLoop()
	return s, nil
}

// PodID returns the stable identity stamped on every record.
func (s *Spool) PodID() string { return s.podID }

// Append queues one record for spooling. Never blocks: a full intake
// channel drops the record and counts it. The record's PodID/PodSeq are
// assigned by the spool; caller-set values are overwritten.
func (s *Spool) Append(r Record) {
	// After Close the writer is gone: a buffered send would sit in the
	// channel forever, a loss no counter would ever see.
	if s.closed.Load() {
		s.droppedIntake.Add(1)
		s.logDropRateLimited("spend spool closed, dropping record")
		return
	}
	select {
	case s.intake <- r:
	default:
		s.droppedIntake.Add(1)
		s.logDropRateLimited("spend spool intake full, dropping record")
	}
}

// Stats reports the spool's drop and append counters.
type Stats struct {
	Appended        uint64
	DroppedIntake   uint64
	DroppedOverflow uint64
}

// Stats snapshots the spool's counters (appended, shipped, dropped).
func (s *Spool) Stats() Stats {
	return Stats{
		Appended:        s.appended.Load(),
		DroppedIntake:   s.droppedIntake.Load(),
		DroppedOverflow: s.droppedOverflow.Load(),
	}
}

// Close stops the writer, sealing and syncing whatever is buffered. Safe
// to call twice; later calls are no-ops.
func (s *Spool) Close() error {
	if !s.closed.CompareAndSwap(false, true) {
		return nil
	}
	close(s.done)
	s.wg.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sealActiveLocked()
}

func (s *Spool) writerLoop() {
	defer s.wg.Done()
	ticker := time.NewTicker(s.flushEvery)
	defer ticker.Stop()
	for {
		select {
		case r := <-s.intake:
			s.writeRecord(r)
		case <-ticker.C:
			s.flushTick()
		case <-s.done:
			// Drain whatever is already queued, then return.
			for {
				select {
				case r := <-s.intake:
					s.writeRecord(r)
				default:
					return
				}
			}
		}
	}
}

func (s *Spool) writeRecord(r Record) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r.PodID = s.podID
	r.PodSeq = s.nextSeq
	line, err := json.Marshal(r)
	if err != nil {
		s.droppedIntake.Add(1)
		s.logDropRateLimited("spend spool marshal failed for %s: %v", r.Command, err)
		return
	}
	if err := s.ensureActiveLocked(); err != nil {
		s.droppedIntake.Add(1)
		s.logDropRateLimited("spend spool cannot open active segment: %v", err)
		return
	}
	if _, err := s.activeBuf.Write(append(line, '\n')); err != nil {
		s.droppedIntake.Add(1)
		s.logDropRateLimited("spend spool write failed: %v", err)
		return
	}
	s.nextSeq++
	s.appended.Add(1)
	s.activeSize += int64(len(line)) + 1
	if s.activeSize >= s.segmentMaxBytes {
		if err := s.sealActiveLocked(); err != nil {
			s.logDropRateLimited("spend spool seal failed: %v", err)
		}
		s.enforceBoundLocked()
	}
}

func (s *Spool) flushTick() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return
	}
	// Sealing on the tick (rather than just flushing) bounds drain latency:
	// a record is shippable at most one flush interval after it was written.
	if err := s.sealActiveLocked(); err != nil {
		s.logDropRateLimited("spend spool flush seal failed: %v", err)
	}
	s.enforceBoundLocked()
}

func (s *Spool) ensureActiveLocked() error {
	if s.active != nil {
		return nil
	}
	f, err := os.OpenFile(filepath.Join(s.dir, activeName), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	s.active = f
	s.activeBuf = bufio.NewWriterSize(f, 64<<10)
	st, err := f.Stat()
	if err == nil {
		s.activeSize = st.Size()
	}
	return nil
}

// sealActiveLocked flushes, fsyncs, and renames the active segment into the
// sealed sequence so the drainer can pick it up.
func (s *Spool) sealActiveLocked() error {
	if s.active == nil {
		return nil
	}
	// bufio errors are sticky: on a failed flush or sync the handle must be
	// released, or every later seal hits the same error, the segment never
	// rotates, and the fd leaks while the file grows unreclaimed.
	if err := s.activeBuf.Flush(); err != nil {
		_ = s.active.Close()
		s.active = nil
		s.activeBuf = nil
		s.activeSize = 0
		return err
	}
	if err := s.active.Sync(); err != nil {
		_ = s.active.Close()
		s.active = nil
		s.activeBuf = nil
		s.activeSize = 0
		return err
	}
	if err := s.active.Close(); err != nil {
		s.active = nil
		s.activeBuf = nil
		s.activeSize = 0
		return err
	}
	s.active = nil
	s.activeBuf = nil
	if s.activeSize == 0 {
		// Nothing written: drop the empty file instead of sealing it.
		_ = os.Remove(filepath.Join(s.dir, activeName))
		return nil
	}
	s.activeSize = 0
	s.segCounter++
	sealed := filepath.Join(s.dir, fmt.Sprintf("%s%020d%s", segPrefix, s.segCounter, segSuffix))
	return os.Rename(filepath.Join(s.dir, activeName), sealed)
}

// enforceBoundLocked deletes oldest sealed segments until total size fits.
func (s *Spool) enforceBoundLocked() {
	segs, total := s.sealedSegmentsLocked()
	for _, seg := range segs {
		if total <= s.maxTotalBytes {
			return
		}
		n, err := countRecords(seg.path)
		if err == nil {
			s.droppedOverflow.Add(uint64(n))
		}
		if err := os.Remove(seg.path); err == nil {
			total -= seg.size
			s.logDropRateLimited("spend spool over budget, dropped oldest segment (%d records)", n)
		}
	}
}

type segInfo struct {
	path string
	size int64
}

func (s *Spool) sealedSegmentsLocked() ([]segInfo, int64) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, 0
	}
	var segs []segInfo
	var total int64
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, segPrefix) || !strings.HasSuffix(name, segSuffix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		segs = append(segs, segInfo{path: filepath.Join(s.dir, name), size: info.Size()})
		total += info.Size()
	}
	sort.Slice(segs, func(i, j int) bool { return segs[i].path < segs[j].path })
	return segs, total + s.activeSize
}

// SealedSegments lists drainable segment paths, oldest first.
func (s *Spool) SealedSegments() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	segs, _ := s.sealedSegmentsLocked()
	paths := make([]string, len(segs))
	for i, seg := range segs {
		paths[i] = seg.path
	}
	return paths
}

// ReadSegment decodes every record in a sealed segment. A trailing partial
// line (a crash mid-write) is skipped, never fatal: its absence is a
// sequence gap, which is the detection mechanism working as designed.
func ReadSegment(path string) ([]Record, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var out []Record
	for _, line := range bytes.Split(data, []byte("\n")) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var r Record
		if err := json.Unmarshal(line, &r); err != nil {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

// Ack deletes a fully shipped segment.
func (s *Spool) Ack(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if filepath.Dir(path) != filepath.Clean(s.dir) {
		return fmt.Errorf("spendemitter: ack outside spool dir")
	}
	return os.Remove(path)
}

func countRecords(path string) (int, error) {
	records, err := ReadSegment(path)
	if err != nil {
		return 0, err
	}
	return len(records), nil
}

// recover seals a previous process's active segment and restores sequence
// and segment counters from what is on disk.
// sealLeftoverActiveLocked handles an active segment left by a process that
// did not close cleanly: seal a non-empty one as-is (a torn last line is
// skipped on read), remove an empty one.
func (s *Spool) sealLeftoverActiveLocked() error {
	st, statErr := os.Stat(filepath.Join(s.dir, activeName))
	if statErr != nil {
		// No leftover active segment (the normal case); nothing to seal.
		return nil //nolint:nilerr // stat failure here means "absent", not an error to surface
	}
	if st.Size() == 0 {
		_ = os.Remove(filepath.Join(s.dir, activeName))
		return nil
	}
	s.segCounter = s.maxSegOrdinalLocked() + 1
	sealed := filepath.Join(s.dir, fmt.Sprintf("%s%020d%s", segPrefix, s.segCounter, segSuffix))
	if err := os.Rename(filepath.Join(s.dir, activeName), sealed); err != nil {
		return fmt.Errorf("spendemitter: seal leftover active segment: %w", err)
	}
	return nil
}

func (s *Spool) recover() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.sealLeftoverActiveLocked(); err != nil {
		return err
	}

	s.segCounter = s.maxSegOrdinalLocked()

	// Highest persisted sequence: scan the newest segments backward until
	// one yields records. Sequence continues from there.
	segs, _ := s.sealedSegmentsLocked()
	for i := len(segs) - 1; i >= 0; i-- {
		records, err := ReadSegment(segs[i].path)
		if err != nil || len(records) == 0 {
			continue
		}
		s.nextSeq = records[len(records)-1].PodSeq + 1
		break
	}
	return nil
}

func (s *Spool) maxSegOrdinalLocked() uint64 {
	segs, _ := s.sealedSegmentsLocked()
	var highest uint64
	for _, seg := range segs {
		base := filepath.Base(seg.path)
		numeric := strings.TrimSuffix(strings.TrimPrefix(base, segPrefix), segSuffix)
		var n uint64
		if _, err := fmt.Sscanf(numeric, "%d", &n); err == nil && n > highest {
			highest = n
		}
	}
	return highest
}

func (s *Spool) loadOrCreatePodID(override string) (string, error) {
	path := filepath.Join(s.dir, podIDFile)
	if override != "" {
		// Deployment identity wins and is persisted for restart continuity
		// checks by consumers (same pod id, continued sequence).
		if err := os.WriteFile(path, []byte(override), 0o600); err != nil {
			return "", err
		}
		return override, nil
	}
	if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
		return string(bytes.TrimSpace(data)), nil
	}
	host, _ := os.Hostname()
	nonce := make([]byte, 4)
	_, _ = rand.Read(nonce)
	id := fmt.Sprintf("%s-%s", host, hex.EncodeToString(nonce))
	if err := os.WriteFile(path, []byte(id), 0o600); err != nil {
		return "", err
	}
	return id, nil
}

func (s *Spool) logDropRateLimited(format string, args ...any) {
	now := time.Now().Unix()
	last := s.lastDropLog.Load()
	if now-last < 10 {
		return
	}
	if s.lastDropLog.CompareAndSwap(last, now) {
		s.logf(format, args...)
	}
}
