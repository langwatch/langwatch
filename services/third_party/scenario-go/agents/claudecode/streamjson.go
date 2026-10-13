package claudecode

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"

	scenario "github.com/langwatch/scenario/go"
)

// Default transcript caps, matching the JS SDK.
const (
	DefaultMaxToolResultChars = 8000
	DefaultMaxToolInputChars  = 30000
)

// Limits caps how much of a tool call and of a tool result reaches the
// conversation. A result is the evidence the agent gathered and a judge reads
// its start (command names, URLs, ids); a call carries what the agent wrote,
// the work under judgement, so it keeps far more room. Lengths count UTF-16
// code units, like JavaScript's String#length. A zero field takes its default.
type Limits struct {
	MaxToolResultChars int
	MaxToolInputChars  int
}

func (l Limits) withDefaults() Limits {
	if l.MaxToolResultChars == 0 {
		l.MaxToolResultChars = DefaultMaxToolResultChars
	}
	if l.MaxToolInputChars == 0 {
		l.MaxToolInputChars = DefaultMaxToolInputChars
	}
	return l
}

// ResultEnvelope is the status the CLI fields on its terminal "result" line.
// IsError is the CLI's own verdict and is trusted over the exit code (a stale
// --resume, for one, can report is_error on a 0 exit). Subtype categorises
// the outcome ("success", "error_during_execution", …) and Errors carries the
// fielded failure sentences. It is zero when no result line was emitted.
type ResultEnvelope struct {
	IsError bool
	Subtype string
	Errors  []string
}

// Transcript is one parsed Claude Code run.
type Transcript struct {
	// Text is the assistant-visible text, tool calls and results rendered
	// inline as "Tool Called: …" and "Tool Result: …" lines.
	Text string
	// Messages is the same run as scenario messages: assistant messages with
	// tool calls, one tool message per tool result, and user messages for
	// any other text Claude Code reported on a user line.
	Messages []scenario.Message
	// SessionID is the last session_id any line carried, or "".
	SessionID string
	// Result is the terminal result envelope.
	Result ResultEnvelope
}

// ParseStreamJSON decodes the stdout of `claude -p --output-format
// stream-json --verbose`, one JSON object per line, as it is read. Lines that
// are not JSON are skipped. An unknown event type is reported once per type
// on logger (nil for silence). Zero limits take the defaults. The error is
// only ever a read error from r.
func ParseStreamJSON(r io.Reader, limits Limits, logger *slog.Logger) (*Transcript, error) {
	p := newParser(limits, logger)
	w := lineWriter{line: p.parseLine}
	if _, err := io.Copy(&w, r); err != nil {
		return nil, err
	}
	w.flush()
	return p.transcript(), nil
}

// parser accumulates a stream-json run line by line.
type parser struct {
	limits    Limits
	logger    *slog.Logger
	warned    map[string]struct{}
	toolNames map[string]string
	text      strings.Builder
	messages  []scenario.Message
	sessionID string
	result    ResultEnvelope
	// textStart and textLines track the message being rendered.
	textStart int
	textLines int

	// onText, when set, receives each piece appended to the text
	// rendering; the pieces concatenate to Transcript.Text.
	onText func(string)
	// onMessage, when set, receives each message as it is converted.
	onMessage func(scenario.Message)
}

func newParser(limits Limits, logger *slog.Logger) *parser {
	if logger == nil {
		logger = discardLogger
	}
	return &parser{limits: limits.withDefaults(), logger: logger}
}

var discardLogger = slog.New(slog.DiscardHandler)

func (p *parser) transcript() *Transcript {
	return &Transcript{
		Text:      p.text.String(),
		Messages:  p.messages,
		SessionID: p.sessionID,
		Result:    p.result,
	}
}

// wireEvent is one stream-json line. Only the fields the transcript reads
// are decoded; the rest is skipped by the decoder.
type wireEvent struct {
	Type      string       `json:"type"`
	Subtype   string       `json:"subtype"`
	SessionID string       `json:"session_id"`
	IsError   *bool        `json:"is_error"`
	Errors    []any        `json:"errors"`
	Message   *wireMessage `json:"message"`
}

// wireMessage is the inner message of a conversational event.
type wireMessage struct {
	Role    string      `json:"role"`
	Content wireContent `json:"content"`
}

// wireContent is a message content: a string or an array of blocks.
type wireContent struct {
	text   string
	isText bool
	blocks []wireBlock
}

// UnmarshalJSON decodes string or block-array content and ignores any other
// shape, so one odd message never drops its line.
func (c *wireContent) UnmarshalJSON(b []byte) error {
	switch b[0] {
	case '"':
		c.text, c.isText = decodeString(b)
	case '[':
		// A type mismatch inside a block leaves that field zero and the
		// rest decoded, which is what a tolerant reader wants.
		_ = json.Unmarshal(b, &c.blocks)
	}
	return nil
}

// wireBlock is one content block. Text and Name are pointers because a
// missing field and an empty string render differently.
type wireBlock struct {
	Type      string  `json:"type"`
	Text      *string `json:"text"`
	Name      *string `json:"name"`
	ID        string  `json:"id"`
	ToolUseID string  `json:"tool_use_id"`
	Input     rawJSON `json:"input"`
	Content   rawJSON `json:"content"`
	// IsError is a tool_result's is_error, kept raw so a non-boolean value
	// cannot fail the line.
	IsError rawJSON `json:"is_error"`
}

// rawJSON holds an undecoded value. It aliases the line being parsed, so it
// must not outlive parseLine. nil means the field was absent.
type rawJSON []byte

// UnmarshalJSON implements json.Unmarshaler without copying.
func (r *rawJSON) UnmarshalJSON(b []byte) error {
	*r = b
	return nil
}

// decodeString decodes a JSON string literal, without the decoder for the
// common case of a literal with no escapes.
func decodeString(b []byte) (string, bool) {
	if inner, ok := plainStringLiteral(b); ok {
		return string(inner), true
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return "", false
	}
	return s, true
}

func hasControl(b []byte) bool {
	for _, c := range b {
		if c < 0x20 {
			return true
		}
	}
	return false
}

// parseLine decodes one stdout line into the transcript.
func (p *parser) parseLine(line []byte) {
	line = bytes.TrimSpace(line)
	// Only an object carries anything; JSON.parse of anything else is a
	// line the JS SDK records and ignores.
	if len(line) == 0 || line[0] != '{' {
		return
	}
	var ev wireEvent
	if err := json.Unmarshal(line, &ev); err != nil {
		var typeErr *json.UnmarshalTypeError
		if !errors.As(err, &typeErr) {
			return // not JSON, e.g. a stray log line
		}
	}
	if ev.SessionID != "" {
		p.sessionID = ev.SessionID
	}
	if ev.Type == "result" {
		p.result = ResultEnvelope{
			IsError: ev.IsError != nil && *ev.IsError,
			Subtype: ev.Subtype,
			Errors:  stringsOf(ev.Errors),
		}
	}
	if ev.Type != "" && !knownEventType(ev.Type) {
		p.warnUnknown(ev.Type)
	}
	if ev.Message != nil {
		p.addMessage(ev.Message)
	}
}

// stringsOf keeps the strings of a decoded array; nil stays nil.
func stringsOf(values []any) []string {
	if values == nil {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, v := range values {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// knownEventType reports the event types the CLI routinely emits. The
// unknown-event warning flags wire-format drift, so it must stay silent on a
// healthy run: rate_limit_event comes on ordinary runs and stream_event is
// the token-level delta of --include-partial-messages.
func knownEventType(t string) bool {
	switch t {
	case "assistant", "user", "system", "result", "rate_limit_event", "stream_event":
		return true
	}
	return false
}

// warnUnknown warns about an unknown event type once per parse, so a
// repeated novel type cannot flood the log.
func (p *parser) warnUnknown(t string) {
	if _, ok := p.warned[t]; ok {
		return
	}
	if p.warned == nil {
		p.warned = map[string]struct{}{}
	}
	p.warned[t] = struct{}{}
	p.logger.Warn("Claude Code stream-json: unknown event type", "type", t)
}
