package pi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
)

// readerBufBytes is bufio's chunk size; maxLineBytes caps one accumulated
// protocol line. The wrapper bounds every field at 1MB, so a legitimate line
// (a tool_end carrying a bounded input AND output, plus envelope) stays well
// under 4MB; anything larger is a protocol violation and is skipped, not
// buffered.
const (
	readerBufBytes = 64 * 1024
	maxLineBytes   = 4 * 1024 * 1024
)

// mailbox is one turn's event channel. The reader delivers into ch; gone is
// closed when the consumer detaches (Stream returned, or a failed Post rolled
// the registration back), so the reader can never block forever on an
// abandoned turn.
type mailbox struct {
	ch       chan wireEvent
	gone     chan struct{}
	goneOnce sync.Once
}

func (m *mailbox) detach() {
	m.goneOnce.Do(func() { close(m.gone) })
}

// reader is the ONE persistent goroutine that consumes the wrapper's stdout
// for the whole process lifetime. It routes events by turnId to per-turn
// mailboxes, closes ready when the wrapper's handshake lands, and closes dead
// (then the parent pipe end) on EOF or a read error, process death, observed
// exactly once, from the one place that can see it.
//
// bufio.Reader.ReadSlice, NEVER bufio.Scanner: a Scanner that hits ErrTooLong
// is permanently wedged, while ReadSlice lets an oversized or unparseable line
// be skipped and the stream resume at the next newline.
type reader struct {
	src io.ReadCloser

	mu    sync.Mutex
	boxes map[string]*mailbox

	ready     chan struct{}
	readyOnce sync.Once
	dead      chan struct{}
	deadOnce  sync.Once
}

func newReader(src io.ReadCloser) *reader {
	return &reader{
		src:   src,
		boxes: map[string]*mailbox{},
		ready: make(chan struct{}),
		dead:  make(chan struct{}),
	}
}

// register creates the mailbox for turnID. Called by Post BEFORE the turn line
// is written to stdin, so no event of the turn can arrive unrouted. The buffer
// absorbs the gap until Stream attaches; a full buffer backpressures the
// reader, which is correct (the wrapper's stdout then backpressures too).
func (r *reader) register(turnID string) *mailbox {
	mb := &mailbox{ch: make(chan wireEvent, 256), gone: make(chan struct{})}
	r.mu.Lock()
	r.boxes[turnID] = mb
	r.mu.Unlock()
	return mb
}

// unregister detaches and removes turnID's mailbox. Idempotent; late events
// for the turn are dropped by deliver.
func (r *reader) unregister(turnID string, mb *mailbox) {
	mb.detach()
	r.mu.Lock()
	if r.boxes[turnID] == mb {
		delete(r.boxes, turnID)
	}
	r.mu.Unlock()
}

func (r *reader) markDead() {
	r.deadOnce.Do(func() { close(r.dead) })
}

// run is the reader goroutine body. It owns closing the source pipe end.
func (r *reader) run(ctx context.Context) {
	defer clog.HandlePanic(ctx, false)
	defer func() {
		r.markDead()
		_ = r.src.Close()
	}()

	br := bufio.NewReaderSize(r.src, readerBufBytes)
	var line []byte
	overflow := false
	for {
		chunk, err := br.ReadSlice('\n')
		if len(chunk) > 0 {
			if len(line)+len(chunk) > maxLineBytes {
				overflow = true
				line = line[:0]
			} else if !overflow {
				line = append(line, chunk...)
			}
		}
		switch {
		case err == nil:
			if overflow {
				clog.Get(ctx).Warn("pi worker line exceeded the size cap, skipped")
			} else {
				r.handleLine(ctx, line)
			}
			line = line[:0]
			overflow = false
		case errors.Is(err, bufio.ErrBufferFull):
			// Mid-line: keep accumulating (or keep discarding an overflow).
			continue
		default:
			// EOF or a broken pipe: the wrapper is gone. A final unterminated
			// fragment is not a protocol line (the wrapper flushes terminals
			// with their newline), drop it.
			return
		}
	}
}

// handleLine decodes and routes one complete protocol line. Unparseable or
// unknown lines are skipped with a warning: a bad line must never take the
// stream down (mirror of the wrapper's own stdin posture).
func (r *reader) handleLine(ctx context.Context, raw []byte) {
	line := bytes.TrimSuffix(bytes.TrimSuffix(raw, []byte("\n")), []byte("\r"))
	if len(bytes.TrimSpace(line)) == 0 {
		return
	}
	var ev wireEvent
	if err := json.Unmarshal(line, &ev); err != nil {
		clog.Get(ctx).Warn("pi worker emitted an unparseable line, skipped", zap.Error(err))
		return
	}
	switch ev.Type {
	case eventReady:
		if ev.Protocol != protocolVersion {
			// Diagnostic only: version 1 is the only protocol that exists, and
			// a mismatched wrapper still speaks enough of it to be driven.
			clog.Get(ctx).Warn("pi worker announced an unexpected protocol version",
				zap.Int("got", ev.Protocol), zap.Int("want", protocolVersion))
		}
		r.readyOnce.Do(func() { close(r.ready) })
	case eventPong:
		// Liveness is driven by the manager-side heartbeat ticker; nothing to do.
	case "":
		clog.Get(ctx).Warn("pi worker emitted a line with no type, skipped")
	default:
		r.deliver(ev)
	}
}

// deliver routes a turn event to its mailbox. No mailbox (a turn that already
// finished, or one this manager never posted) drops the event, PROTOCOL.md
// says nothing follows a terminal, so a late event is wrapper noise.
func (r *reader) deliver(ev wireEvent) {
	if ev.TurnID == "" {
		return
	}
	r.mu.Lock()
	mb := r.boxes[ev.TurnID]
	r.mu.Unlock()
	if mb == nil {
		return
	}
	select {
	case mb.ch <- ev:
	case <-mb.gone:
	}
}
