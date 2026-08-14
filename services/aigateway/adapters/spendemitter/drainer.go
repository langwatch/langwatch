package spendemitter

import (
	"context"
	"sync"
	"time"
)

// Shipper delivers one batch of records; the ingest client in production,
// a stub in tests.
type Shipper interface {
	Ship(ctx context.Context, records []Record) error
}

// Drainer ships sealed spool segments to the ingest endpoint, oldest first,
// at-least-once: a segment is deleted only after its batch was acked.
// Failures back off exponentially (1s doubling to 60s) without ever
// touching the spool contents; the spool's own size bound is the only
// thing that discards data, visibly.
type Drainer struct {
	spool   *Spool
	shipper Shipper
	tick    time.Duration
	backoff time.Duration
	logf    func(format string, args ...any)

	cancelMu sync.Mutex
	cancel   context.CancelFunc
}

// DrainerOptions configures NewDrainer.
type DrainerOptions struct {
	Spool   *Spool
	Shipper Shipper
	// Tick is the idle poll interval for new sealed segments. Default 2s.
	Tick time.Duration
	Logf func(format string, args ...any)
}

const (
	drainBackoffFloor = time.Second
	drainBackoffCap   = 60 * time.Second
)

// NewDrainer builds a drainer; run it with Start.
func NewDrainer(opts DrainerOptions) *Drainer {
	if opts.Tick <= 0 {
		opts.Tick = 2 * time.Second
	}
	if opts.Logf == nil {
		opts.Logf = func(string, ...any) {}
	}
	return &Drainer{
		spool:   opts.Spool,
		shipper: opts.Shipper,
		tick:    opts.Tick,
		logf:    opts.Logf,
	}
}

// Start launches the drain loop, which runs until ctx is canceled or Stop is
// called. Matches the lifecycle.Worker shape, which is fire-and-forget: a
// Start that blocks wedges the whole lifecycle group before it arms its
// signal handler, and the process then dies on the first SIGTERM with no
// graceful shutdown at all. The cancel func is installed before the loop
// launches so a Stop that lands immediately after Start cannot miss it.
func (d *Drainer) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	d.cancelMu.Lock()
	d.cancel = cancel
	d.cancelMu.Unlock()
	go d.run(ctx)
}

// Stop cancels a running Start.
func (d *Drainer) Stop() {
	d.cancelMu.Lock()
	defer d.cancelMu.Unlock()
	if d.cancel != nil {
		d.cancel()
	}
}

// nextBackoff advances the retry ladder one step: floor on the first
// failure, doubling up to the cap after that.
func (d *Drainer) nextBackoff() time.Duration {
	if d.backoff == 0 {
		d.backoff = drainBackoffFloor
		return d.backoff
	}
	d.backoff *= 2
	if d.backoff > drainBackoffCap {
		d.backoff = drainBackoffCap
	}
	return d.backoff
}

// waitFor sleeps for wait (or returns early on ctx cancel), resetting the
// timer defensively for pre-Go-1.23 semantics. Returns false when the
// context was canceled and the loop should stop.
func (d *Drainer) waitFor(ctx context.Context, timer *time.Timer, wait time.Duration) bool {
	// A fired-but-undrained timer keeps its value buffered and Reset does
	// not clear it, which would collapse the backoff ladder into a tight
	// loop. Drain defensively.
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(wait)
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// waitAfter turns one drain outcome into the next wait: the backoff ladder
// on failure, zero (keep draining) while a backlog remains, the idle tick
// otherwise.
func (d *Drainer) waitAfter(shipped bool, err error) time.Duration {
	if err != nil {
		wait := d.nextBackoff()
		d.logf("spend drainer ship failed, retrying in %s: %v", wait, err)
		return wait
	}
	d.backoff = 0
	if shipped {
		// Backlog may remain; keep draining without idling.
		return 0
	}
	return d.tick
}

func (d *Drainer) run(ctx context.Context) {
	timer := time.NewTimer(d.tick)
	defer timer.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		shipped, err := d.drainOnce(ctx)
		wait := d.waitAfter(shipped, err)
		if wait == 0 {
			continue
		}
		if !d.waitFor(ctx, timer, wait) {
			return
		}
	}
}

// drainOnce ships the oldest sealed segment, if any. Returns whether a
// segment was shipped.
func (d *Drainer) drainOnce(ctx context.Context) (bool, error) {
	segments := d.spool.SealedSegments()
	if len(segments) == 0 {
		return false, nil
	}
	oldest := segments[0]
	records, err := ReadSegment(oldest)
	if err != nil {
		return false, err
	}
	if len(records) > 0 {
		if err := d.shipper.Ship(ctx, records); err != nil {
			return false, err
		}
	}
	if err := d.spool.Ack(oldest); err != nil {
		return false, err
	}
	return true, nil
}
