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
type eventBus struct {
	mu      sync.Mutex
	cond    sync.Cond
	queue   []Event
	closed  bool
	done    chan struct{}
	deliver func(Event)
}

func newEventBus(deliver func(Event)) *eventBus {
	b := &eventBus{done: make(chan struct{}), deliver: deliver}
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
			b.deliver(batch[i])
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
	select {
	case <-b.done:
	case <-t.C:
		logger().Warn("timed out draining scenario events", "timeout", timeout.String())
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

func (d *eventDelivery) deliver(ev Event) {
	if d.listener != nil {
		d.listener(ev)
	}
	if d.reporter == nil || !d.reporter.enabled() {
		return
	}
	setURL := d.reporter.postWithRetry(context.Background(), ev)
	if ev.Type == EventRunStarted && setURL != "" {
		d.alerts.watchMessage(context.Background(), d.setID, setURL, d.lw)
	}
}
