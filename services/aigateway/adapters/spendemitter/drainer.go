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

// NewDrainer builds a drainer; run it with Start (blocking, lifecycle-style).
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

// Start runs the drain loop until ctx is canceled or Stop is called.
// Signature matches lifecycle.Worker.
func (d *Drainer) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	d.cancelMu.Lock()
	d.cancel = cancel
	d.cancelMu.Unlock()
	d.run(ctx)
}

// Stop cancels a running Start.
func (d *Drainer) Stop() {
	d.cancelMu.Lock()
	defer d.cancelMu.Unlock()
	if d.cancel != nil {
		d.cancel()
	}
}

func (d *Drainer) run(ctx context.Context) {
	timer := time.NewTimer(d.tick)
	defer timer.Stop()
	for {
		wait := d.tick
		if shipped, err := d.drainOnce(ctx); err != nil {
			if d.backoff == 0 {
				d.backoff = drainBackoffFloor
			} else {
				d.backoff *= 2
				if d.backoff > drainBackoffCap {
					d.backoff = drainBackoffCap
				}
			}
			wait = d.backoff
			d.logf("spend drainer ship failed, retrying in %s: %v", wait, err)
		} else {
			d.backoff = 0
			if shipped {
				// Backlog may remain; keep draining without idling.
				wait = 0
			}
		}
		if wait == 0 {
			select {
			case <-ctx.Done():
				return
			default:
				continue
			}
		}
		// Pre-Go-1.23 timer semantics: a fired-but-undrained timer keeps its
		// value buffered and Reset does not clear it, which would collapse
		// the backoff ladder into a tight loop. Drain defensively.
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(wait)
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
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
