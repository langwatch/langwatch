package engine

import (
	"regexp"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// imageDataURLRe matches an inline image data URL. The base64 payload match
// is greedy over the base64 alphabet so the whole image is captured as one
// token; templates interpolate the URL as a single uninterrupted string.
var imageDataURLRe = regexp.MustCompile(`data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}`)

// splitMessagesWithImages rewrites messages whose string content embeds image
// data URLs into OpenAI multimodal content-part lists (text part, image part,
// text part), mirroring the Python engine's DSPy split. Without this the
// model receives the base64 bytes as literal text and can only guess what
// the image shows. Messages without images pass through untouched, as does
// content that is already a parts list.
//
// A system message that contains an image is split further: providers reject
// image parts in system-role messages, so the text before the first image
// stays as the system prompt and everything from the first image onward is
// re-homed into a user message inserted right after it.
func splitMessagesWithImages(messages []app.ChatMessage) []app.ChatMessage {
	out := make([]app.ChatMessage, 0, len(messages))
	for _, m := range messages {
		s, ok := m.Content.(string)
		if !ok || !strings.Contains(s, "data:image/") {
			out = append(out, m)
			continue
		}
		parts := splitImageDataURLs(s)
		if m.Role == "system" {
			systemText, rest := splitLeadingText(parts)
			if systemText != "" {
				out = append(out, app.ChatMessage{Role: "system", Content: systemText})
			}
			if len(rest) > 0 {
				out = append(out, app.ChatMessage{Role: "user", Content: rest})
			}
			continue
		}
		m.Content = parts
		out = append(out, m)
	}
	return out
}

// splitImageDataURLs breaks text into a multimodal content-part list: every
// image data URL becomes {type: image_url} and the text around it becomes
// {type: text}. Whitespace-only text segments are dropped so adjacent images
// don't produce empty parts.
func splitImageDataURLs(text string) []any {
	matches := imageDataURLRe.FindAllStringIndex(text, -1)
	parts := make([]any, 0, len(matches)*2+1)
	last := 0
	appendText := func(seg string) {
		if strings.TrimSpace(seg) == "" {
			return
		}
		parts = append(parts, map[string]any{"type": "text", "text": seg})
	}
	for _, loc := range matches {
		appendText(text[last:loc[0]])
		parts = append(parts, map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": text[loc[0]:loc[1]]},
		})
		last = loc[1]
	}
	appendText(text[last:])
	return parts
}

// splitLeadingText peels the text parts that precede the first image off a
// parts list, returning them joined as the retained system prompt plus the
// remainder (first image onward) for the re-homed user message.
func splitLeadingText(parts []any) (string, []any) {
	texts := make([]string, 0, len(parts))
	for i, p := range parts {
		block, ok := p.(map[string]any)
		if ok && block["type"] == "text" {
			t, _ := block["text"].(string)
			texts = append(texts, t)
			continue
		}
		return strings.Join(texts, ""), parts[i:]
	}
	return strings.Join(texts, ""), nil
}
