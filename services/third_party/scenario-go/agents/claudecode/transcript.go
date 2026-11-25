package claudecode

import (
	"bytes"
	"strconv"
	"unicode/utf8"

	scenario "github.com/langwatch/scenario/go"
	"github.com/langwatch/scenario/go/internal/jsjson"
	"github.com/langwatch/scenario/go/internal/jsstr"
)

// This file turns one inner stream-json message into its two renderings:
// the inline text and scenario messages. Claude Code writes Anthropic-format
// messages: an assistant turn is an array of thinking, text and tool_use
// blocks, and each tool result comes back on a user message holding
// tool_result blocks. Thinking is dropped; a block of any other type leaves
// a line naming it, so the judge never reads a turn with a silent gap.
//
// The text rendering is written straight into the transcript text: each
// message's non-empty blocks on their own lines, messages separated by a
// blank line.

// literalTrue is the JSON of a set is_error flag.
var literalTrue = []byte("true")

// addMessage renders one inner message into the transcript.
func (p *parser) addMessage(m *wireMessage) {
	c := &m.Content
	if c.isText {
		p.beginText()
		p.textLine(c.text)
		p.endText()
		if m.Role == "assistant" || m.Role == "user" {
			p.emit(scenario.Message{Role: scenario.Role(m.Role), Content: c.text})
		}
		return
	}
	if c.blocks == nil {
		return
	}
	switch m.Role {
	case "assistant":
		p.addAssistantBlocks(c.blocks)
	case "user":
		p.addUserBlocks(c.blocks)
	default:
		p.beginText()
		for i := range c.blocks {
			b := &c.blocks[i]
			switch b.Type {
			case "tool_use":
				p.writeToolUse(b, jsonValue(b.Input))
			case "tool_result":
				p.writeToolResult(p.toolResultValue(b))
			default:
				p.textLine(blockText(b))
			}
		}
		p.endText()
	}
}

// addAssistantBlocks renders an assistant turn: one message with the text it
// wrote (empty when it only called tools) and the tool calls it made.
func (p *parser) addAssistantBlocks(blocks []wireBlock) {
	var texts joiner
	var calls []scenario.ToolCall
	p.beginText()
	for i := range blocks {
		b := &blocks[i]
		switch b.Type {
		case "text":
			if b.Text != nil {
				p.textLine(*b.Text)
				texts.add(*b.Text)
			}
		case "tool_use":
			input := jsonValue(b.Input)
			p.writeToolUse(b, input)
			name := "tool"
			if b.Name != nil {
				name = *b.Name
			}
			p.rememberTool(b.ID, name)
			calls = append(calls, scenario.ToolCall{ID: b.ID, Name: name, Arguments: p.toolArguments(b.Input, input)})
		case "tool_result":
			p.writeToolResult(p.toolResultValue(b))
		case "thinking", "redacted_thinking":
		default:
			marker := unsupportedBlockText(b)
			p.textLine(marker)
			texts.add(marker)
		}
	}
	p.endText()
	if texts.n == 0 && len(calls) == 0 {
		return
	}
	p.emit(scenario.Message{
		Role:      scenario.RoleAssistant,
		Parts:     []scenario.Part{scenario.TextPart(texts.String())},
		ToolCalls: calls,
	})
}

// addUserBlocks renders a user turn: its tool results become tool messages,
// and whatever text it carries a user message after them.
func (p *parser) addUserBlocks(blocks []wireBlock) {
	var texts joiner
	p.beginText()
	for i := range blocks {
		b := &blocks[i]
		switch b.Type {
		case "text":
			if b.Text != nil {
				p.textLine(*b.Text)
				texts.add(*b.Text)
			}
		case "tool_result":
			value := p.toolResultValue(b)
			p.writeToolResult(value)
			name, ok := p.toolNames[b.ToolUseID]
			if !ok {
				name = "tool"
			}
			p.emit(scenario.Message{
				Role:       scenario.RoleTool,
				ToolCallID: b.ToolUseID,
				ToolName:   name,
				Content:    value,
				IsError:    bytes.Equal(b.IsError, literalTrue),
			})
		case "tool_use":
			p.writeToolUse(b, jsonValue(b.Input))
		case "thinking", "redacted_thinking":
		default:
			marker := unsupportedBlockText(b)
			p.textLine(marker)
			texts.add(marker)
		}
	}
	p.endText()
	if texts.n > 0 {
		p.emit(scenario.Message{Role: scenario.RoleUser, Content: texts.String()})
	}
}

// beginText starts one message's text rendering.
func (p *parser) beginText() {
	p.textStart = p.text.Len()
	p.textLines = 0
}

// textLine starts a new line of the current message unless s is empty.
func (p *parser) textLine(s string) {
	if s == "" {
		return
	}
	p.newLine()
	p.text.WriteString(s)
}

func (p *parser) newLine() {
	switch {
	case p.textLines > 0:
		p.text.WriteByte('\n')
	case p.textStart > 0:
		p.text.WriteString("\n\n")
	}
	p.textLines++
}

// endText reports what the current message added to the text.
func (p *parser) endText() {
	if p.onText != nil && p.textLines > 0 {
		p.onText(p.text.String()[p.textStart:])
	}
}

// writeToolUse writes "Tool Called: name(<input JSON, capped>)".
func (p *parser) writeToolUse(b *wireBlock, input any) {
	name := "unknown"
	if b.Name != nil {
		name = *b.Name
	}
	args := ""
	if b.Input != nil {
		args = jsjson.Stringify(input)
	}
	p.newLine()
	p.text.WriteString("Tool Called: ")
	p.text.WriteString(name)
	p.text.WriteByte('(')
	p.text.WriteString(truncateText(args, p.limits.MaxToolInputChars))
	p.text.WriteByte(')')
}

// writeToolResult writes "Tool Result: <capped content>".
func (p *parser) writeToolResult(value string) {
	p.newLine()
	p.text.WriteString("Tool Result: ")
	p.text.WriteString(value)
}

func (p *parser) emit(m scenario.Message) {
	p.messages = append(p.messages, m)
	if p.onMessage != nil {
		p.onMessage(m)
	}
}

func (p *parser) rememberTool(id, name string) {
	if p.toolNames == nil {
		p.toolNames = map[string]string{}
	}
	p.toolNames[id] = name
}

// blockText is the inline rendering of a block other than a tool block.
func blockText(b *wireBlock) string {
	switch b.Type {
	case "text":
		if b.Text != nil {
			return *b.Text
		}
		return ""
	case "thinking", "redacted_thinking":
		return ""
	}
	return unsupportedBlockText(b)
}

// unsupportedBlockText is what a block the conversation has no part for
// (most often an image or a document a tool returned) leaves behind.
func unsupportedBlockText(b *wireBlock) string {
	t := b.Type
	if t == "" {
		t = "unknown"
	}
	return "[" + t + " block, not shown in the transcript]"
}

// toolArguments is the JSON of a tool call input with every string inside
// it capped; a missing or null input is an empty object.
func (p *parser) toolArguments(raw rawJSON, input any) string {
	if input == nil {
		return "{}"
	}
	// A JSON string literal is never shorter in bytes than its value in
	// UTF-16 units, so an input that fits the cap holds no string to cap.
	if len(raw) > p.limits.MaxToolInputChars {
		input = truncateToolInput(input, p.limits.MaxToolInputChars)
	}
	return jsjson.Stringify(input)
}

// toolResultValue is a tool_result block's content as capped text. A plain
// string result, the common case, is capped before it is copied, so a
// result of hundreds of kilobytes costs only its kept prefix.
func (p *parser) toolResultValue(b *wireBlock) string {
	limit := p.limits.MaxToolResultChars
	if inner, ok := plainStringLiteral(b.Content); ok {
		if len(inner) <= limit {
			return string(inner)
		}
		return truncateBytes(inner, limit)
	}
	return truncateText(toolResultText(b.Content), limit)
}

// toolResultText renders tool_result content readably: a string as is, the
// text parts of an array (other parts as JSON), anything else as JSON.
func toolResultText(raw rawJSON) string {
	if raw == nil {
		return ""
	}
	if raw[0] == '"' {
		s, _ := decodeString(raw)
		return s
	}
	v := jsonValue(raw)
	parts, ok := v.([]any)
	if !ok {
		return jsjson.Stringify(v)
	}
	var out joiner
	for _, part := range parts {
		switch x := part.(type) {
		case string:
			out.addNonEmpty(x)
		case jsjson.Object:
			if text, ok := x.Get("text"); ok {
				if s, ok := text.(string); ok {
					out.addNonEmpty(s)
					continue
				}
			}
			out.addNonEmpty(jsjson.Stringify(x))
		default:
			out.addNonEmpty(jsjson.Stringify(x))
		}
	}
	return out.String()
}

// jsonValue parses a raw value in JSON.parse form, nil when absent or null.
func jsonValue(raw rawJSON) any {
	if raw == nil {
		return nil
	}
	v, err := jsjson.Parse(string(raw))
	if err != nil {
		return nil
	}
	return v
}

// truncateText caps s at limit UTF-16 units and says how much it dropped.
func truncateText(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	n := jsstr.Len(s)
	if n <= limit {
		return s
	}
	return jsstr.Prefix(s, limit) + truncationNote(n-limit)
}

// truncateBytes is truncateText over valid UTF-8 bytes, copying only what
// it keeps.
func truncateBytes(b []byte, limit int) string {
	units, cut := 0, -1
	for i := 0; i < len(b); {
		w, size := 1, 1
		if c := b[i]; c >= utf8.RuneSelf {
			var r rune
			r, size = utf8.DecodeRune(b[i:])
			if r >= 0x10000 {
				w = 2
			}
		}
		if cut < 0 && units+w > limit {
			cut = i
		}
		units += w
		i += size
	}
	if cut < 0 {
		return string(b)
	}
	return string(b[:cut]) + truncationNote(units-limit)
}

func truncationNote(dropped int) string {
	return "\n… [" + strconv.Itoa(dropped) + " more characters]"
}

// plainStringLiteral returns the inside of a JSON string literal that needs
// no unescaping, which is then its value byte for byte.
func plainStringLiteral(raw rawJSON) ([]byte, bool) {
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return nil, false
	}
	inner := raw[1 : len(raw)-1]
	if bytes.IndexByte(inner, '\\') >= 0 || bytes.IndexByte(inner, '"') >= 0 || hasControl(inner) || !utf8.Valid(inner) {
		return nil, false
	}
	return inner, true
}

// truncateToolInput caps every string inside a tool input, structure kept:
// a payload such as {"body":{"html":…}} carries the same unbounded text a
// top-level field would.
func truncateToolInput(v any, limit int) any {
	switch x := v.(type) {
	case string:
		return truncateText(x, limit)
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = truncateToolInput(e, limit)
		}
		return out
	case jsjson.Object:
		out := make(jsjson.Object, len(x))
		for i, m := range x {
			out[i] = jsjson.Member{Key: m.Key, Value: truncateToolInput(m.Value, limit)}
		}
		return out
	}
	return v
}

// joiner joins strings with "\n" without allocating for zero or one string.
type joiner struct {
	first string
	buf   []byte
	n     int
}

func (j *joiner) add(s string) {
	switch j.n {
	case 0:
		j.first = s
	case 1:
		j.buf = append(append(append(j.buf, j.first...), '\n'), s...)
	default:
		j.buf = append(append(j.buf, '\n'), s...)
	}
	j.n++
}

func (j *joiner) addNonEmpty(s string) {
	if s != "" {
		j.add(s)
	}
}

func (j *joiner) String() string {
	switch j.n {
	case 0:
		return ""
	case 1:
		return j.first
	}
	return string(j.buf)
}
