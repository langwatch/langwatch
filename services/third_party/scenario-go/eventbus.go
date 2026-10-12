package scenario

import (
	"context"
	"sync"
	"time"
)

// eventBus delivers the events of one run in publish order on a single
// goroutine. Publishing never blocks and never drops: the queue is
// unbounded, and drain waits for every queued event to be delivered (or for
// the drain timeout).
//
// Delivery runs under the bus's context, which lives until the drain ends:
// when the drain times out it is cancelled, so an in-flight post and its
// retries stop and the events still queued are dropped instead of being
// posted for minutes after the run returned.
type eventBus struct {
	mu      sync.Mutex
	cond    sync.Cond
	queue   []Event
	closed  bool
	done    chan struct{}
	deliver func(context.Context, Event)
	ctx     context.Context
	cancel  context.CancelFunc
}

func newEventBus(deliver func(context.Context, Event)) *eventBus {
	ctx, cancel := context.WithCancel(context.Background())
	b := &eventBus{done: make(chan struct{}), deliver: deliver, ctx: ctx, cancel: cancel}
	b.cond.L = &b.mu
	go b.loop()
	return b
}

func (b *eventBus) publish(ev Event) {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		logger().Warn("event published after the bus drained; dropped", "type", string(ev.Type))
		return
	}
	b.queue = append(b.queue, ev)
	b.mu.Unlock()
	b.cond.Signal()
}

func (b *eventBus) loop() {
	defer close(b.done)
	var batch []Event
	for {
		b.mu.Lock()
		for len(b.queue) == 0 && !b.closed {
			b.cond.Wait()
		}
		if len(b.queue) == 0 && b.closed {
			b.mu.Unlock()
			return
		}
		batch, b.queue = b.queue, batch[:0]
		b.mu.Unlock()
		for i := range batch {
			if b.ctx.Err() == nil {
				b.deliver(b.ctx, batch[i])
			}
			batch[i] = Event{}
		}
	}
}

// drain stops accepting events and waits until the queue is delivered or
// the timeout passes.
func (b *eventBus) drain(timeout time.Duration) {
	b.mu.Lock()
	b.closed = true
	b.mu.Unlock()
	b.cond.Broadcast()
	t := time.NewTimer(timeout)
	defer t.Stop()
	defer b.cancel()
	select {
	case <-b.done:
	case <-t.C:
		b.mu.Lock()
		left := len(b.queue)
		b.mu.Unlock()
		logger().Warn("timed out draining scenario events; dropping the undelivered ones", "timeout", timeout.String(), "queued", left)
	}
}

// eventDelivery posts each event and handles the side effects of a
// delivered event (the "follow it live" message).
type eventDelivery struct {
	reporter *eventReporter
	listener func(Event)
	alerts   *alertLogger
	setID    string
	lw       LangWatchConfig
}

func (d *eventDelivery) deliver(ctx context.Context, ev Event) {
	if d.listener != nil {
		d.listener(ev)
	}
	if d.reporter == nil || !d.reporter.enabled() {
		return
	}
	setURL := d.reporter.postWithRetry(ctx, ev)
	if ev.Type == EventRunStarted && setURL != "" {
		d.alerts.watchMessage(ctx, d.setID, setURL, d.lw)
	}
}
