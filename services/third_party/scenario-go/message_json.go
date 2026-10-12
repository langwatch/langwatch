package scenario

import (
	"encoding/base64"
	"strings"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

// This file encodes messages in the Vercel AI SDK ModelMessage shape the JS
// SDK works with natively. The judge transcript and the agent span input are
// built from it, so their text matches what the JS SDK produces.

// appendModelContent appends the JSON of the message content in AI SDK form:
// a string for plain text, otherwise an array of parts. With truncate set,
// inline media payloads become "[AUDIO: audio/wav, ~N bytes]" markers, as
// the JS judge transcript does.
func appendModelContent(b []byte, m Message, truncate bool) []byte {
	if m.Role == RoleSystem || m.isPlainText() {
		return jsjson.AppendString(b, m.Text())
	}
	b = append(b, '[')
	n := 0
	sep := func() {
		if n > 0 {
			b = append(b, ',')
		}
		n++
	}
	if m.Role == RoleTool {
		sep()
		b = appendToolResultPart(b, m)
		return append(b, ']')
	}
	for _, p := range m.contentParts() {
		sep()
		b = appendModelPart(b, p, truncate)
	}
	for _, tc := range m.ToolCalls {
		sep()
		b = appendToolCallPart(b, tc)
	}
	return append(b, ']')
}

// appendModelPart appends one AI SDK content part.
func appendModelPart(b []byte, p Part, truncate bool) []byte {
	switch p.Type {
	case PartText:
		b = append(b, `{"type":"text","text":`...)
		b = jsjson.AppendString(b, p.Text)
		return append(b, '}')
	case PartImage:
		b = append(b, `{"type":"image","image":`...)
		switch {
		case p.URL != "":
			b = jsjson.AppendString(b, p.URL)
		case truncate && base64.StdEncoding.EncodedLen(len(p.Data)) > 1000:
			b = jsjson.AppendString(b, "[IMAGE: unknown, ~"+itoa(base64.StdEncoding.EncodedLen(len(p.Data)))+" bytes]")
		default:
			b = appendBase64String(b, p.Data)
		}
		if p.MediaType != "" {
			b = append(b, `,"mediaType":`...)
			b = jsjson.AppendString(b, p.MediaType)
		}
		return append(b, '}')
	case PartFile:
		b = append(b, `{"type":"file","mediaType":`...)
		b = jsjson.AppendString(b, p.MediaType)
		b = append(b, `,"data":`...)
		switch {
		case p.URL != "":
			b = jsjson.AppendString(b, p.URL)
		case truncate:
			category, _, _ := strings.Cut(p.MediaType, "/")
			b = jsjson.AppendString(b, "["+strings.ToUpper(category)+": "+p.MediaType+", ~"+itoa(base64.StdEncoding.EncodedLen(len(p.Data)))+" bytes]")
		default:
			b = appendBase64String(b, p.Data)
		}
		if p.Filename != "" {
			b = append(b, `,"filename":`...)
			b = jsjson.AppendString(b, p.Filename)
		}
		return append(b, '}')
	}
	if len(p.Raw) > 0 {
		return append(b, p.Raw...)
	}
	b = append(b, `{"type":`...)
	b = jsjson.AppendString(b, string(p.Type))
	return append(b, '}')
}

func appendBase64String(b []byte, data []byte) []byte {
	b = append(b, '"')
	b = base64.StdEncoding.AppendEncode(b, data)
	return append(b, '"')
}

func appendToolCallPart(b []byte, tc ToolCall) []byte {
	b = append(b, `{"type":"tool-call","toolCallId":`...)
	b = jsjson.AppendString(b, tc.ID)
	b = append(b, `,"toolName":`...)
	b = jsjson.AppendString(b, tc.Name)
	b = append(b, `,"input":`...)
	b = appendToolInput(b, tc.Arguments)
	return append(b, '}')
}

// appendToolInput appends tool call arguments as the parsed JSON value the AI
// SDK holds, or as a string when they are not valid JSON.
func appendToolInput(b []byte, args string) []byte {
	if args == "" {
		return append(b, "{}"...)
	}
	if v, err := jsjson.Parse(args); err == nil {
		return jsjson.Append(b, v)
	}
	return jsjson.AppendString(b, args)
}

func appendToolResultPart(b []byte, m Message) []byte {
	b = append(b, `{"type":"tool-result","toolCallId":`...)
	b = jsjson.AppendString(b, m.ToolCallID)
	b = append(b, `,"toolName":`...)
	b = jsjson.AppendString(b, m.ToolName)
	b = append(b, `,"output":`...)
	if v, ok := toolOutputJSON(m.Text()); ok {
		b = append(b, `{"type":"json","value":`...)
		b = jsjson.Append(b, v)
	} else {
		b = append(b, `{"type":"text","value":`...)
		b = jsjson.AppendString(b, m.Text())
	}
	return append(b, "}}"...)
}

// toolOutputJSON reports whether a tool result is a JSON object or array, the
// shape the AI SDK carries as a "json" output rather than "text".
func toolOutputJSON(content string) (any, bool) {
	if !jsjson.LooksLikeJSON(content) {
		return nil, false
	}
	v, err := jsjson.Parse(content)
	if err != nil {
		return nil, false
	}
	return v, true
}

// appendToolOutputValue appends JSON.stringify(output.value) for a tool
// result: the compact JSON of an object/array result, or the quoted string.
func appendToolOutputValue(b []byte, content string) []byte {
	if v, ok := toolOutputJSON(content); ok {
		return jsjson.Append(b, v)
	}
	return jsjson.AppendString(b, content)
}

// modelMessageJSON appends {"role":…,"content":…} for span inputs/outputs.
func appendModelMessage(b []byte, m Message) []byte {
	b = append(b, `{"role":`...)
	b = jsjson.AppendString(b, string(m.Role))
	b = append(b, `,"content":`...)
	b = appendModelContent(b, m, false)
	return append(b, '}')
}

// AppendMessageJSON appends the message as the JSON of an AI SDK
// ModelMessage, {"role":…,"content":…}, the shape the JS SDK sends.
func AppendMessageJSON(b []byte, m Message) []byte { return appendModelMessage(b, m) }

// AppendMessageContentJSON appends the content of the message as the AI SDK
// holds it: a string for plain text, otherwise an array of parts.
func AppendMessageContentJSON(b []byte, m Message) []byte { return appendModelContent(b, m, false) }

// MessageText returns the text a state transcript shows for a message: its
// text, or its parts joined by newlines with tool calls and results as JSON.
func MessageText(m Message) string { return messageText(m) }

// buildJudgeTranscript renders one "role: <content JSON>" line per message,
// with inline media truncated, as the JS JudgeUtils transcript does.
func buildJudgeTranscript(messages []Message) string {
	b := make([]byte, 0, 128*len(messages))
	for i, m := range messages {
		if i > 0 {
			b = append(b, '\n')
		}
		b = append(b, m.Role...)
		b = append(b, ": "...)
		b = appendModelContent(b, m, true)
	}
	return string(b)
}

// messageText is the text a state transcript shows for a message: the string
// content, or its parts joined by newlines with tool calls and results as
// their JSON.
func messageText(m Message) string {
	if m.Role == RoleSystem || m.isPlainText() {
		return m.Text()
	}
	var out []string
	if m.Role == RoleTool {
		return string(appendToolResultPart(nil, m))
	}
	for _, p := range m.contentParts() {
		var s string
		if p.Type == PartText {
			s = p.Text
		} else {
			s = string(appendModelPart(nil, p, false))
		}
		if s != "" {
			out = append(out, s)
		}
	}
	for _, tc := range m.ToolCalls {
		out = append(out, string(appendToolCallPart(nil, tc)))
	}
	return strings.Join(out, "\n")
}

// transcript is the conversation as one "role: text" line per message.
func transcript(messages []Message) string {
	var b strings.Builder
	for i, m := range messages {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(string(m.Role))
		b.WriteString(": ")
		b.WriteString(messageText(m))
	}
	return b.String()
}

func itoa(n int) string {
	var buf [20]byte
	return string(jsjson.AppendNumber(buf[:0], float64(n)))
}
