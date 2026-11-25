package llm

import (
	"encoding/base64"

	scenario "github.com/langwatch/scenario/go"
)

// toWireMessages converts messages to the OpenAI chat format the proxy speaks.
func toWireMessages(messages []scenario.Message) []map[string]any {
	out := make([]map[string]any, 0, len(messages))
	for i := range messages {
		out = append(out, toWireMessage(&messages[i]))
	}
	return out
}

func toWireMessage(m *scenario.Message) map[string]any {
	switch m.Role {
	case scenario.RoleAssistant:
		msg := map[string]any{"role": "assistant", "content": m.Text()}
		if len(m.ToolCalls) > 0 {
			calls := make([]map[string]any, 0, len(m.ToolCalls))
			for _, tc := range m.ToolCalls {
				calls = append(calls, map[string]any{
					"id": tc.ID, "type": "function",
					"function": map[string]any{"name": tc.Name, "arguments": tc.Arguments},
				})
			}
			msg["tool_calls"] = calls
		}
		return msg
	case scenario.RoleTool:
		return map[string]any{"role": "tool", "tool_call_id": m.ToolCallID, "content": m.Text()}
	case scenario.RoleUser:
		return map[string]any{"role": "user", "content": userContent(m)}
	case scenario.RoleSystem:
		return map[string]any{"role": "system", "content": m.Text()}
	}
	return map[string]any{"role": string(m.Role), "content": m.Text()}
}

// userContent is the text alone, or content parts when the message carries media.
func userContent(m *scenario.Message) any {
	if len(m.Parts) == 0 {
		return m.Content
	}
	parts := make([]map[string]any, 0, len(m.Parts))
	for i := range m.Parts {
		parts = append(parts, wirePart(&m.Parts[i]))
	}
	return parts
}

func wirePart(p *scenario.Part) map[string]any {
	switch p.Type {
	case scenario.PartImage:
		url := p.URL
		if url == "" {
			url = "data:" + p.MediaType + ";base64," + base64.StdEncoding.EncodeToString(p.Data)
		}
		return map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}}
	case scenario.PartFile:
		if p.IsAudio() {
			return map[string]any{"type": "input_audio", "input_audio": map[string]any{
				"data": base64.StdEncoding.EncodeToString(p.Data), "format": audioFormat(p.MediaType),
			}}
		}
		return map[string]any{"type": "file", "file": map[string]any{
			"filename": p.Filename, "file_data": "data:" + p.MediaType + ";base64," + base64.StdEncoding.EncodeToString(p.Data),
		}}
	case scenario.PartText:
		return map[string]any{"type": "text", "text": p.Text}
	}
	return map[string]any{"type": "text", "text": p.Text}
}

func audioFormat(mediaType string) string {
	if mediaType == "audio/mpeg" || mediaType == "audio/mp3" {
		return "mp3"
	}
	return "wav"
}

func toWireTools(tools []scenario.ToolDefinition) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		fn := map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Parameters}
		if t.Strict {
			fn["strict"] = true
		}
		out = append(out, map[string]any{"type": "function", "function": fn})
	}
	return out
}

func toWireToolChoice(c *scenario.ToolChoice) any {
	switch c.Type {
	case scenario.ToolChoiceTool:
		return map[string]any{"type": "function", "function": map[string]any{"name": c.ToolName}}
	case scenario.ToolChoiceAuto, scenario.ToolChoiceRequired, scenario.ToolChoiceNone:
		return string(c.Type)
	}
	return string(c.Type)
}
