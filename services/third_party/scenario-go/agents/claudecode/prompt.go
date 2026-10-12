package claudecode

import (
	"encoding/base64"
	"strings"

	scenario "github.com/langwatch/scenario/go"
	"github.com/langwatch/scenario/go/internal/jsjson"
)

// formatPrompt flattens messages into the single prompt `claude -p` takes:
// one "role: content" paragraph per message. Structured content is made
// readable rather than dropped, so a tool call or a tool result survives as
// "[tool-call: …]" and "[tool-result: …]" lines. toolNames resolves the tool
// of a result message that does not name it.
func formatPrompt(messages []scenario.Message, toolNames func(callID string) string) string {
	var b strings.Builder
	for i := range messages {
		m := &messages[i]
		if i > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(string(m.Role))
		b.WriteString(": ")
		writeContent(&b, m, toolNames)
	}
	return b.String()
}

// writeContent writes a message's content the way the JS SDK renders the
// AI SDK form of it: text as is, every other part on its own line.
func writeContent(b *strings.Builder, m *scenario.Message, toolNames func(string) string) {
	if m.Role == scenario.RoleSystem || (len(m.Parts) == 0 && len(m.ToolCalls) == 0 && m.Role != scenario.RoleTool) {
		b.WriteString(m.Text())
		return
	}
	if m.Role == scenario.RoleTool {
		name := m.ToolName
		if name == "" {
			name = toolNames(m.ToolCallID)
		}
		b.WriteString("[tool-result: " + name + " -> " + string(appendToolOutput(nil, m.Text(), m.IsError)) + "]")
		return
	}
	var lines joiner
	if len(m.Parts) == 0 {
		lines.addNonEmpty(m.Content)
	}
	for i := range m.Parts {
		lines.addNonEmpty(renderPart(&m.Parts[i]))
	}
	for _, tc := range m.ToolCalls {
		lines.add("[tool-call: " + tc.Name + "(" + jsjson.Stringify(toolInput(tc.Arguments)) + ")]")
	}
	b.WriteString(lines.String())
}

// renderPart renders one content part.
func renderPart(p *scenario.Part) string {
	switch p.Type {
	case scenario.PartText:
		return p.Text
	case scenario.PartFile:
		return fileLine(p.MediaType)
	case scenario.PartImage:
		return string(appendImagePart(nil, p))
	}
	if len(p.Raw) > 0 {
		return renderRawPart(p.Raw)
	}
	return jsjson.Stringify(jsjson.Object{{Key: "type", Value: string(p.Type)}})
}

// renderRawPart renders a custom part from its JSON, by its AI SDK type.
func renderRawPart(raw []byte) string {
	v, err := jsjson.Parse(string(raw))
	if err != nil {
		return string(raw)
	}
	obj, ok := v.(jsjson.Object)
	if !ok {
		return jsjson.Stringify(v)
	}
	field := func(key string) any { v, _ := obj.Get(key); return v }
	switch field("type") {
	case "text", "reasoning":
		s, _ := field("text").(string)
		return s
	case "tool-call":
		return "[tool-call: " + nameOf(field("toolName")) + "(" + jsjson.Stringify(field("input")) + ")]"
	case "tool-result":
		out := field("output")
		if out == nil {
			out = field("result")
		}
		return "[tool-result: " + nameOf(field("toolName")) + " -> " + jsjson.Stringify(out) + "]"
	case "file":
		mt, _ := field("mediaType").(string)
		return fileLine(mt)
	}
	return jsjson.Stringify(obj)
}

func nameOf(v any) string {
	if v == nil {
		return "unknown"
	}
	if s, ok := v.(string); ok {
		return s
	}
	return jsjson.Stringify(v)
}

func fileLine(mediaType string) string {
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	return "[file: " + mediaType + "]"
}

// appendImagePart appends the AI SDK JSON of an image part.
func appendImagePart(b []byte, p *scenario.Part) []byte {
	b = append(b, `{"type":"image","image":`...)
	if p.URL != "" {
		b = jsjson.AppendString(b, p.URL)
	} else {
		b = append(b, '"')
		b = base64.StdEncoding.AppendEncode(b, p.Data)
		b = append(b, '"')
	}
	if p.MediaType != "" {
		b = append(b, `,"mediaType":`...)
		b = jsjson.AppendString(b, p.MediaType)
	}
	return append(b, '}')
}

// toolInput is a tool call's arguments as the AI SDK holds them: the parsed
// JSON value, the raw string when it is not JSON, an empty object when empty.
func toolInput(args string) any {
	if args == "" {
		return jsjson.Object{}
	}
	if v, err := jsjson.Parse(args); err == nil {
		return v
	}
	return args
}

// appendToolOutput appends the AI SDK output of a tool result: JSON for an
// object or array result, text otherwise, as "error-json" / "error-text"
// when the call failed.
func appendToolOutput(b []byte, content string, isError bool) []byte {
	kind := "text"
	var value any = content
	if jsjson.LooksLikeJSON(content) {
		if v, err := jsjson.Parse(content); err == nil {
			kind, value = "json", v
		}
	}
	if isError {
		kind = "error-" + kind
	}
	b = append(b, `{"type":"`...)
	b = append(b, kind...)
	b = append(b, `","value":`...)
	b = jsjson.Append(b, value)
	return append(b, '}')
}

// hasRenderableContent reports whether a formatted prompt carries anything
// past its "role:" labels. `claude -p ""` would silently mask a wiring bug
// (an agent placed first, or a resume turn with no new messages).
func hasRenderableContent(prompt string) bool {
	for line := range strings.SplitSeq(prompt, "\n") {
		if i := strings.IndexByte(line, ':'); i >= 0 {
			line = line[i+1:]
		}
		if strings.TrimSpace(line) != "" {
			return true
		}
	}
	return false
}
