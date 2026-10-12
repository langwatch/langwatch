package scenario

import (
	"errors"
	"fmt"
	"slices"
	"sync"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// ExecutionState is the live state of a scenario run: the conversation, the
// turn counter and views over the messages and the collected spans. It is
// safe for concurrent use, so agents running a non-blocking turn may read it
// while the script continues.
type ExecutionState struct {
	mu          sync.RWMutex
	config      ScenarioConfig
	messages    []Message
	rows        [][]byte // AG-UI JSON per message, encoded on demand
	model       [][]byte // AI SDK model message JSON per message, on demand
	currentTurn int
	spans       func() []sdktrace.ReadOnlySpan
	reads       *StateReads
	onRollback  func(removed map[string]bool)
}

func newExecutionState(cfg ScenarioConfig) *ExecutionState {
	return &ExecutionState{
		config:   cfg,
		messages: make([]Message, 0, 2*cfg.MaxTurns+2),
		rows:     make([][]byte, 0, 2*cfg.MaxTurns+2),
		model:    make([][]byte, 0, 2*cfg.MaxTurns+2),
		spans:    func() []sdktrace.ReadOnlySpan { return nil },
	}
}

// Config returns the scenario configuration.
func (s *ExecutionState) Config() ScenarioConfig { return s.config }

// Description returns the scenario description.
func (s *ExecutionState) Description() string { return s.config.Description }

// ThreadID returns the conversation thread id.
func (s *ExecutionState) ThreadID() string { return s.config.ThreadID }

// CurrentTurn returns the current turn. It is 0 during the first turn, the
// way the JS executor counts.
func (s *ExecutionState) CurrentTurn() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.currentTurn
}

func (s *ExecutionState) setTurn(turn int) {
	s.mu.Lock()
	s.currentTurn = turn
	s.mu.Unlock()
}

func (s *ExecutionState) incrementTurn() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.currentTurn++
	return s.currentTurn
}

// Messages returns a copy of the conversation.
func (s *ExecutionState) Messages() []Message {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return slices.Clip(slices.Clone(s.messages))
}

// Len returns the number of messages.
func (s *ExecutionState) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.messages)
}

// add stores a message, assigning its id (unless id is given) and turn, and
// returns the stored message and its index.
func (s *ExecutionState) add(m Message, id string) (Message, int) {
	m = m.clone()
	if id == "" {
		id = generateMessageID()
	}
	m.ID = id
	s.mu.Lock()
	m.Turn = s.currentTurn
	s.messages = append(s.messages, m)
	s.rows = append(s.rows, nil)
	s.model = append(s.model, nil)
	idx := len(s.messages) - 1
	s.mu.Unlock()
	return m, idx
}

// aguiRowsJSON returns the AG-UI JSON of every message, encoding each one
// at most once for the life of the run.
func (s *ExecutionState) aguiRowsJSON() [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([][]byte, len(s.messages))
	for i := range s.messages {
		if s.rows[i] == nil {
			s.rows[i] = aguiRows(s.messages[i])[0].json
		}
		out[i] = s.rows[i]
	}
	return out
}

func (s *ExecutionState) setSpanProvider(f func() []sdktrace.ReadOnlySpan) { s.spans = f }

func (s *ExecutionState) setOnRollback(f func(removed map[string]bool)) { s.onRollback = f }

// ErrNoMessages is returned by the Last* accessors on an empty conversation.
var ErrNoMessages = errors.New("no messages in history")

// LastMessage returns the last message.
func (s *ExecutionState) LastMessage() (Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.messages) == 0 {
		return Message{}, ErrNoMessages
	}
	return s.messages[len(s.messages)-1], nil
}

func (s *ExecutionState) lastWithRole(role Role, missing string) (Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.messages) == 0 {
		return Message{}, ErrNoMessages
	}
	for i := len(s.messages) - 1; i >= 0; i-- {
		if s.messages[i].Role == role {
			return s.messages[i], nil
		}
	}
	return Message{}, errors.New(missing)
}

// LastUserMessage returns the last user message.
func (s *ExecutionState) LastUserMessage() (Message, error) {
	return s.lastWithRole(RoleUser, "no user message in history")
}

// LastAgentMessage returns the last assistant message.
func (s *ExecutionState) LastAgentMessage() (Message, error) {
	return s.lastWithRole(RoleAssistant, "no agent message in history")
}

// LastToolCall returns the last tool result message of the named tool.
func (s *ExecutionState) LastToolCall(toolName string) (Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.messages) == 0 {
		return Message{}, ErrNoMessages
	}
	names := toolNamesByCallID(s.messages)
	for i := len(s.messages) - 1; i >= 0; i-- {
		if m := s.messages[i]; m.Role == RoleTool && resultToolName(m, names) == toolName {
			return m, nil
		}
	}
	return Message{}, fmt.Errorf("no tool call result for tool %q in history", toolName)
}

// HasToolCall reports whether the named tool returned a result.
func (s *ExecutionState) HasToolCall(toolName string) bool {
	_, err := s.LastToolCall(toolName)
	return err == nil
}

func toolNamesByCallID(messages []Message) map[string]string {
	names := map[string]string{}
	for _, m := range messages {
		for _, tc := range m.ToolCalls {
			names[tc.ID] = tc.Name
		}
	}
	return names
}

func resultToolName(m Message, names map[string]string) string {
	if m.ToolName != "" {
		return m.ToolName
	}
	return names[m.ToolCallID]
}

// Fields returns the scenario fields.
func (s *ExecutionState) Fields() map[string]FieldValue { return s.config.Fields }

// Field returns one scenario field; a missing or blank field reports false
// (0 and false are values).
func (s *ExecutionState) Field(name string) (FieldValue, bool) {
	v, ok := s.config.Fields[name]
	if !ok || v == nil || v == "" {
		s.noteBlankField(name)
		return nil, false
	}
	return v, true
}

// CriteriaProvider is implemented by judges that expose their criteria.
type CriteriaProvider interface {
	Criteria() []string
}

// Criteria returns the criteria of every judge, in order.
func (s *ExecutionState) Criteria() []string {
	var out []string
	for _, a := range s.config.Agents {
		if j, ok := a.(CriteriaProvider); ok && a.Role() == AgentRoleJudge {
			out = append(out, j.Criteria()...)
		}
	}
	return out
}

// FirstUserMessage returns the text of the first user message, or "".
func (s *ExecutionState) FirstUserMessage() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, m := range s.messages {
		if m.Role == RoleUser {
			return messageText(m)
		}
	}
	return ""
}

// Transcript returns the conversation as one "role: content" line per
// message.
func (s *ExecutionState) Transcript() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return transcript(s.messages)
}

// RollbackMessagesTo removes the messages from index onward (clamped to the
// conversation length) and returns them. Pending message queues of the
// agents are cleaned so no agent sees a removed message. Safe only from
// within an agent call, like the JS SDK.
func (s *ExecutionState) RollbackMessagesTo(index int) ([]Message, error) {
	if index < 0 {
		return nil, fmt.Errorf("rollbackMessagesTo: index must be >= 0, got %d", index)
	}
	s.mu.Lock()
	index = min(index, len(s.messages))
	removed := slices.Clone(s.messages[index:])
	clear(s.messages[index:])
	s.messages = s.messages[:index]
	clear(s.rows[index:])
	s.rows = s.rows[:index]
	clear(s.model[index:])
	s.model = s.model[:index]
	s.mu.Unlock()
	if len(removed) > 0 && s.onRollback != nil {
		ids := make(map[string]bool, len(removed))
		for _, m := range removed {
			ids[m.ID] = true
		}
		s.onRollback(ids)
	}
	return removed, nil
}

// StateReads records what views a mapping read and what it found missing.
type StateReads struct {
	// Trace is set when spans, traces, contexts or tool calls were read.
	Trace bool
	// BlankFields are fields read that the scenario leaves blank.
	BlankFields []string
	// MissingToolCalls are tool names asked for that nothing carries.
	MissingToolCalls []string
	// EmptyContexts is set when contexts were read and none exist.
	EmptyContexts bool
}

// StartReadTracking starts recording what the next reads touch; evaluator
// runners use it to tell whether a mapping depended on the trace.
func (s *ExecutionState) StartReadTracking() {
	s.mu.Lock()
	s.reads = &StateReads{}
	s.mu.Unlock()
}

// TakeReads stops recording and returns what was read.
func (s *ExecutionState) TakeReads() StateReads {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.reads
	s.reads = nil
	if r == nil {
		return StateReads{}
	}
	return *r
}

func (s *ExecutionState) note(f func(r *StateReads)) {
	s.mu.Lock()
	if s.reads != nil {
		f(s.reads)
	}
	s.mu.Unlock()
}

func (s *ExecutionState) noteTrace() { s.note(func(r *StateReads) { r.Trace = true }) }

func (s *ExecutionState) noteBlankField(name string) {
	s.note(func(r *StateReads) {
		if !slices.Contains(r.BlankFields, name) {
			r.BlankFields = append(r.BlankFields, name)
		}
	})
}

func (s *ExecutionState) noteMissingToolCall(name string) {
	s.note(func(r *StateReads) {
		if !slices.Contains(r.MissingToolCalls, name) {
			r.MissingToolCalls = append(r.MissingToolCalls, name)
		}
	})
}

// chatMessagesInput returns the langwatch.input value of an agent span: the
// conversation as a chat_messages typed value, each message encoded at most
// once for the run.
func (s *ExecutionState) chatMessagesInput() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	size := 40
	for i := range s.messages {
		if s.model[i] == nil {
			s.model[i] = appendModelMessage(nil, s.messages[i])
		}
		size += len(s.model[i]) + 1
	}
	b := make([]byte, 0, size)
	b = append(b, `{"type":"chat_messages","value":[`...)
	for i, enc := range s.model {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, enc...)
	}
	return string(append(b, "]}"...))
}

// chatMessagesValue encodes messages as a chat_messages typed value.
func chatMessagesValue(msgs []Message) string {
	b := make([]byte, 0, 64*len(msgs)+40)
	b = append(b, `{"type":"chat_messages","value":[`...)
	for i, m := range msgs {
		if i > 0 {
			b = append(b, ',')
		}
		b = appendModelMessage(b, m)
	}
	return string(append(b, "]}"...))
}
