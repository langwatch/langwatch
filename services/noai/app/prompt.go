package app

import "encoding/json"

// ExtractLastUserTextChat walks the chat-completions messages array
// backwards and returns the text of the last user message. Supports both
// string-form content (`"content": "..."`) and array-form multimodal
// content (`"content": [{"type":"text","text":"..."}, ...]`). Returns
// "" when no user text is present.
func ExtractLastUserTextChat(messages []ChatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		m := messages[i]
		if m.Role != "user" {
			continue
		}
		if text := pickStringContent(m.Content); text != "" {
			return text
		}
		if text := pickArrayTextContent(m.Content); text != "" {
			return text
		}
	}
	return ""
}

// ExtractLastUserTextResponses pulls text from a /v1/responses request
// body's `input` field, which is either a bare string or a list of items
// in OpenAI's Responses input shape.
func ExtractLastUserTextResponses(input json.RawMessage) string {
	if len(input) == 0 {
		return ""
	}
	// Case 1: a bare string.
	var asString string
	if err := json.Unmarshal(input, &asString); err == nil {
		return asString
	}
	// Case 2: an array of items. Walk backwards looking for a user-role
	// item with text content. Be permissive — the Responses API has
	// several content-part shapes (input_text, output_text, etc.).
	var items []struct {
		Role    string          `json:"role"`
		Type    string          `json:"type"`
		Content json.RawMessage `json:"content"`
		Text    string          `json:"text"`
	}
	if err := json.Unmarshal(input, &items); err != nil {
		return ""
	}
	for i := len(items) - 1; i >= 0; i-- {
		item := items[i]
		if item.Role != "" && item.Role != "user" {
			continue
		}
		if item.Text != "" {
			return item.Text
		}
		if len(item.Content) == 0 {
			continue
		}
		if text := pickArrayTextContent(item.Content); text != "" {
			return text
		}
	}
	return ""
}

// pickStringContent returns the value when raw is a JSON string.
func pickStringContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return ""
}

// pickArrayTextContent returns the joined text of all text-typed parts in
// a JSON array of content parts. Supports OpenAI's chat shape (`text`),
// the Responses input shape (`input_text` + `text`), and the Responses
// output shape (`output_text` + `text`).
func pickArrayTextContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &parts); err != nil {
		return ""
	}
	out := ""
	for _, p := range parts {
		switch p.Type {
		case "text", "input_text", "output_text":
			if p.Text != "" {
				if out != "" {
					out += " "
				}
				out += p.Text
			}
		}
	}
	return out
}
