package scenario

import "sync"

// eventEmitter turns run lifecycle changes into events. It is the seam
// between the executor and the event bus: the executor reports what
// happened (run started, message added, rollback, run finished) and the
// emitter decides which events that means.
//
// Snapshot mode (the default, as in the JS SDK) posts a MESSAGE_SNAPSHOT of
// the whole conversation on every message. Granular mode posts
// TEXT_MESSAGE_START/END per message (with CONTENT and TOOL_CALL_* progress
// from agents streaming through AgentInput.Stream) and falls back to a
// snapshot for anything the granular protocol cannot express: a rollback, a
// stream aborted without a message, or a message landing at another index
// than its stream announced (a second END for a message id is ignored by
// the backend).
//
// Events are numbered and published under one lock, so the bus receives
// them in emission order. Timestamps are assigned at creation, never on
// send, and snapshots get strictly increasing timestamps because the
// backend deduplicates snapshots by timestamp.
type eventEmitter struct {
	mu           sync.Mutex
	base         eventBase
	granular     bool
	publish      func(Event)
	state        *ExecutionState
	seq          uint64
	lastTS       int64
	lastSnapshot int64
}

func (e *eventEmitter) emitLocked(t EventType, build func(ts int64) []byte, snapshot bool) {
	if e.publish == nil {
		return // nobody consumes events: skip building them
	}
	ts := nowMillis()
	if ts < e.lastTS {
		ts = e.lastTS
	}
	if snapshot && ts <= e.lastSnapshot {
		ts = e.lastSnapshot + 1
	}
	if snapshot {
		e.lastSnapshot = ts
	}
	e.lastTS = ts
	e.seq++
	e.publish(Event{Type: t, Seq: e.seq, Timestamp: ts, ScenarioRunID: e.base.scenarioRunID, Payload: build(ts)})
}

func (e *eventEmitter) runStarted(cfg ScenarioConfig, agents []runAgent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.emitLocked(EventRunStarted, func(ts int64) []byte { return e.base.runStartedPayload(ts, cfg, agents) }, false)
}

func (e *eventEmitter) runFinished(status RunStatus, r *ScenarioResult) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.emitLocked(EventRunFinished, func(ts int64) []byte { return e.base.runFinishedPayload(ts, status, r) }, false)
}

func (e *eventEmitter) snapshotLocked() {
	if e.publish == nil {
		return
	}
	e.emitLocked(EventMessageSnapshot, func(ts int64) []byte {
		var payload []byte
		e.state.withAGUIRowsJSON(func(rows [][]byte) { payload = e.base.snapshotPayload(ts, rows) })
		return payload
	}, true)
}

// messageAdded stores a message with store and reports it at the index it
// was stored at. stream is the stream of the agent call the message
// answers, when it was bound to it. Storing happens under the emitter lock,
// so messages added concurrently (a non-blocking agent turn next to the
// script) are reported in the order of their indices.
func (e *eventEmitter) messageAdded(store func() (Message, int), stream *MessageStream) Message {
	e.mu.Lock()
	defer e.mu.Unlock()
	m, index := store()
	if !e.granular {
		e.snapshotLocked()
		return m
	}
	if e.publish == nil {
		return m
	}
	row := aguiRowOf(m)
	// A later snapshot (rollback, aborted stream) reuses this encoding.
	e.state.keepAGUIRow(index, m.ID, row.json)
	startIndex := index
	if stream != nil && stream.started {
		startIndex = stream.index
		stream.closed = true
	} else {
		e.emitLocked(EventTextMessageStart, func(ts int64) []byte {
			return e.base.textMessageStartPayload(ts, row.id, row.role, index)
		}, false)
	}
	e.emitLocked(EventTextMessageEnd, func(ts int64) []byte {
		return e.base.textMessageEndPayload(ts, row, index)
	}, false)
	if startIndex != index {
		e.snapshotLocked()
	}
	return m
}

// rolledBack reconciles a rollback, which only a snapshot can express.
func (e *eventEmitter) rolledBack() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.snapshotLocked()
}

// streamFinished closes a stream after its agent call. A stream that
// started but produced no message is an aborted message, reconciled by a
// snapshot.
func (e *eventEmitter) streamFinished(s *MessageStream) {
	if s == nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	aborted := s.started && !s.closed
	s.closed = true
	if aborted {
		e.snapshotLocked()
	}
}

// newStream returns the progress stream of an agent call, or nil (a no-op
// stream) in snapshot mode.
func (e *eventEmitter) newStream(role Role) *MessageStream {
	if !e.granular {
		return nil
	}
	return &MessageStream{emitter: e, role: role}
}

// MessageStream lets an agent report progress while it produces a message:
// text deltas and tool call progress. The message the agent returns stays
// authoritative; the stream only shows it live. All methods are no-ops on a
// nil stream, which is what agents get when granular events are off.
type MessageStream struct {
	emitter *eventEmitter
	id      string
	role    Role
	index   int
	started bool
	closed  bool
}

// startLocked announces the message on first progress.
func (s *MessageStream) startLocked() {
	if s.started {
		return
	}
	s.started = true
	s.id = generateMessageID()
	s.index = s.emitter.state.Len()
	e := s.emitter
	e.emitLocked(EventTextMessageStart, func(ts int64) []byte {
		return e.base.textMessageStartPayload(ts, s.id, s.role, s.index)
	}, false)
}

func (s *MessageStream) emit(t EventType, build func(ts int64) []byte) {
	if s == nil {
		return
	}
	s.emitter.mu.Lock()
	defer s.emitter.mu.Unlock()
	if s.closed {
		return
	}
	s.startLocked()
	s.emitter.emitLocked(t, build, false)
}

// TextDelta streams a piece of the message text.
func (s *MessageStream) TextDelta(delta string) {
	if s == nil || delta == "" {
		return
	}
	s.emit(EventTextMessageContent, func(ts int64) []byte {
		return s.emitter.base.textMessageContentPayload(ts, s.id, delta)
	})
}

// ToolCallStart announces a tool call of the message.
func (s *MessageStream) ToolCallStart(toolCallID, toolName string) {
	if s == nil {
		return
	}
	s.emit(EventToolCallStart, func(ts int64) []byte {
		return s.emitter.base.toolCallStartPayload(ts, toolCallID, toolName, s.id)
	})
}

// ToolCallArgs streams a piece of a tool call's JSON arguments.
func (s *MessageStream) ToolCallArgs(toolCallID, delta string) {
	if s == nil {
		return
	}
	s.emit(EventToolCallArgs, func(ts int64) []byte {
		return s.emitter.base.toolCallArgsPayload(ts, toolCallID, delta)
	})
}

// ToolCallEnd marks a tool call's arguments complete.
func (s *MessageStream) ToolCallEnd(toolCallID string) {
	if s == nil {
		return
	}
	s.emit(EventToolCallEnd, func(ts int64) []byte {
		return s.emitter.base.toolCallEndPayload(ts, toolCallID)
	})
}

// bindID returns the message id a message produced by the stream's call
// takes: the stream's own id for the first message of the stream's role
// when the stream started, so END reconciles the streamed START.
func (s *MessageStream) bindID(role Role) string {
	if s == nil {
		return ""
	}
	s.emitter.mu.Lock()
	defer s.emitter.mu.Unlock()
	if !s.started || s.closed || role != s.role {
		return ""
	}
	return s.id
}
