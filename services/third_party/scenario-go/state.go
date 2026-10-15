package scenario

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/scenario/go/internal/spandigest"
)

// ExecutionState is the live state of a scenario run: the conversation, the
// turn counter and views over the messages and the collected spans. It is
// safe for concurrent use, so agents running a non-blocking turn may read it
// while the script continues.
type ExecutionState struct {
	mu     sync.RWMutex
	config ScenarioConfig
	// messages is append-only between rollbacks: an element below len is
	// never written again, and a rollback moves the kept messages to a new
	// array, so views handed out by messagesView stay valid and unchanged.
	messages    []Message
	rows        [][]byte // AG-UI JSON per message, encoded on demand
	model       [][]byte // AI SDK model message JSON per message, on demand
	currentTurn int
	spans       func() []sdktrace.ReadOnlySpan
	reads       *StateReads
	onRollback  func(removed map[string]bool)
	// digests keeps the judge's rendering of the run's ended spans.
	digests *spandigest.Cache
}

func newExecutionState(cfg ScenarioConfig) *ExecutionState {
	return &ExecutionState{
		config:   cfg,
		messages: make([]Message, 0, 2*cfg.MaxTurns+2),
		rows:     make([][]byte, 0, 2*cfg.MaxTurns+2),
		model:    make([][]byte, 0, 2*cfg.MaxTurns+2),
		spans:    func() []sdktrace.ReadOnlySpan { return nil },
		digests:  spandigest.NewCache(),
	}
}

// spanDigests returns the run's span digest cache; nil (no caching) for a
// nil state.
func (s *ExecutionState) spanDigests() *spandigest.Cache {
	if s == nil {
		return nil
	}
	return s.digests
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

// messagesView returns the conversation without copying it: a slice of the
// stored messages capped at its length, so an append by the holder copies
// instead of writing into the state. Holders must not modify its elements;
// see the messages field for why the view never changes under them.
func (s *ExecutionState) messagesView() []Message {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.messages[:len(s.messages):len(s.messages)]
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
	return s.addEncoded(m, id, nil)
}

// addEncoded is add with the message's model JSON (appendModelMessage of
// m) already at hand, kept so chatMessagesInput does not encode it again;
// nil encodes on demand.
func (s *ExecutionState) addEncoded(m Message, id string, model []byte) (Message, int) {
	m = m.clone()
	if id == "" {
		id = generateMessageID()
	}
	m.ID = id
	s.mu.Lock()
	m.Turn = s.currentTurn
	s.messages = append(s.messages, m)
	s.rows = append(s.rows, nil)
	s.model = append(s.model, model)
	idx := len(s.messages) - 1
	s.mu.Unlock()
	return m, idx
}

// aguiRowsJSON returns the AG-UI JSON of every message, encoding each one
// at most once for the life of the run.
func (s *ExecutionState) aguiRowsJSON() [][]byte {
	var out [][]byte
	s.withAGUIRowsJSON(func(rows [][]byte) { out = slices.Clone(rows) })
	return out
}

// withAGUIRowsJSON calls f with the AG-UI JSON of every message, encoding
// each one at most once for the life of the run, under the state lock and
// without copying the list: f must not keep rows or call into the state.
func (s *ExecutionState) withAGUIRowsJSON(f func(rows [][]byte)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.messages {
		if s.rows[i] == nil {
			s.rows[i] = aguiRowOf(s.messages[i]).json
		}
	}
	f(s.rows)
}

// keepAGUIRow stores the AG-UI JSON of the message at index, already
// encoded by the caller, unless the message there is no longer the one with
// id (a rollback in between).
func (s *ExecutionState) keepAGUIRow(index int, id string, json []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if index < len(s.messages) && s.messages[index].ID == id && s.rows[index] == nil {
		s.rows[index] = json
	}
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
	// A new array for the kept messages: views of the old one (agents
	// holding messagesView) keep seeing the conversation they were given,
	// and the next add cannot overwrite a removed message they still hold.
	if index < len(s.messages) {
		kept := make([]Message, index, cap(s.messages))
		copy(kept, s.messages[:index])
		s.messages = kept
	}
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
	for i := range s.messages {
		if s.model[i] == nil {
			s.model[i] = encodeModelMessage(s.messages[i])
		}
	}
	return chatMessagesJSON(s.model)
}

// encodeModelMessages returns the model JSON of each message, the pieces
// of chatMessagesJSON that the state can keep (addEncoded).
func encodeModelMessages(msgs []Message) [][]byte {
	out := make([][]byte, len(msgs))
	for i, m := range msgs {
		out[i] = encodeModelMessage(m)
	}
	return out
}

// chatMessagesJSON joins encoded model messages as a chat_messages typed
// value.
func chatMessagesJSON(encoded [][]byte) string {
	size := 40
	for _, e := range encoded {
		size += len(e) + 1
	}
	var b strings.Builder
	b.Grow(size)
	b.WriteString(`{"type":"chat_messages","value":[`)
	for i, e := range encoded {
		if i > 0 {
			b.WriteByte(',')
		}
		b.Write(e)
	}
	b.WriteString("]}")
	return b.String()
}

// chatMessagesValue encodes messages as a chat_messages typed value.
func chatMessagesValue(msgs []Message) string {
	return chatMessagesJSON(encodeModelMessages(msgs))
}
