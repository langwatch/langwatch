package engine

import (
	"encoding/base64"
	"regexp"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// attachmentDataURLRe matches an inline base64 data URL of any media type. The
// base64 payload match is greedy over the base64 alphabet so the whole payload
// is captured as one token; templates interpolate the URL as a single
// uninterrupted string. Case-insensitive because RFC 2397 allows uppercase in
// the scheme, media type, and the ";base64" extension token.
var attachmentDataURLRe = regexp.MustCompile(`(?i)data:[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9!#$&^_.+-]+;base64,[A-Za-z0-9+/]+={0,2}`)

// dataURLMediaTypeRe reads the media type out of a matched data URL.
var dataURLMediaTypeRe = regexp.MustCompile(`(?i)^data:([^;,]+);base64,`)

// splitMessagesWithAttachments rewrites messages whose string content embeds
// base64 data URLs into OpenAI multimodal content-part lists (text part,
// attachment part, text part), mirroring the Python engine's DSPy split.
// Without this the model receives the base64 bytes as literal text and can only
// guess what the attachment holds. Messages without one pass through untouched,
// as does content that is already a parts list.
//
// Each data URL becomes the part its media type calls for: a picture becomes an
// image part, audio an input_audio part, a PDF or another binary a file part,
// and text-like content is decoded back into readable text.
//
// A system message that gains a non-text part is split further: providers
// reject such parts in system-role messages, so the text before the first
// attachment stays as the system prompt and everything from the attachment
// onward is re-homed into a user message inserted right after it.
func splitMessagesWithAttachments(messages []app.ChatMessage) []app.ChatMessage {
	out := make([]app.ChatMessage, 0, len(messages))
	for _, m := range messages {
		out = append(out, splitOneMessageWithAttachments(m)...)
	}
	return out
}

// splitOneMessageWithAttachments returns what one message becomes: itself when
// it holds no inline attachment, itself with the parts list when it does, or a
// system turn plus a user turn when a non-text part landed in the instructions.
func splitOneMessageWithAttachments(m app.ChatMessage) []app.ChatMessage {
	s, ok := m.Content.(string)
	if !ok {
		return []app.ChatMessage{m}
	}
	// One case-insensitive regex scan decides pass-through; a plain Contains
	// guard would miss uppercase schemes (DATA:IMAGE/...), and content without
	// attachments must stay a plain string, never a single-element parts list.
	matches := attachmentDataURLRe.FindAllStringIndex(s, -1)
	if len(matches) == 0 {
		return []app.ChatMessage{m}
	}
	parts, attached := splitAttachmentDataURLs(s, matches)
	if !attached {
		return []app.ChatMessage{m}
	}
	if !hasNonTextPart(parts) {
		// Every data URL decoded to readable text, so the message stays a plain
		// string with the text in place of the base64.
		m.Content = joinTextParts(parts)
		return []app.ChatMessage{m}
	}
	if m.Role == "system" {
		return rehomeSystemAttachments(parts)
	}
	m.Content = parts
	return []app.ChatMessage{m}
}

// rehomeSystemAttachments keeps the text before the first attachment as the
// system prompt and moves the attachment onward into a user message right
// after it, because providers reject non-text parts in a system message.
func rehomeSystemAttachments(parts []any) []app.ChatMessage {
	systemText, rest := splitLeadingText(parts)
	out := make([]app.ChatMessage, 0, 2)
	if systemText != "" {
		out = append(out, app.ChatMessage{Role: "system", Content: systemText})
	}
	if len(rest) > 0 {
		out = append(out, app.ChatMessage{Role: "user", Content: rest})
	}
	return out
}

// splitAttachmentDataURLs breaks text into a multimodal content-part list:
// every data URL (located by the caller's attachmentDataURLRe matches) becomes
// the part its media type calls for and the text around it becomes
// {type: text}. Whitespace-only text segments are dropped so adjacent
// attachments don't produce empty parts. The second return is false when no
// data URL yielded a part, so the caller keeps the original string.
func splitAttachmentDataURLs(text string, matches [][]int) ([]any, bool) {
	parts := make([]any, 0, len(matches)*2+1)
	last := 0
	attached := false
	appendText := func(seg string) {
		if strings.TrimSpace(seg) == "" {
			return
		}
		parts = append(parts, map[string]any{"type": "text", "text": seg})
	}
	for _, loc := range matches {
		appendText(text[last:loc[0]])
		token := text[loc[0]:loc[1]]
		last = loc[1]
		part, ok := partForDataURL(token)
		if !ok {
			// The payload is not decodable base64: keep it verbatim rather
			// than dropping content the author put in the prompt.
			appendText(token)
			continue
		}
		parts = append(parts, part)
		attached = true
	}
	appendText(text[last:])
	return parts, attached
}

// partForDataURL turns one inline data URL into its content part. An image
// keeps the matched token verbatim as its URL — providers accept it as written,
// and re-encoding would rewrite the author's own spelling. Every other type is
// decoded so the part can carry the bytes in the shape the provider expects.
func partForDataURL(token string) (map[string]any, bool) {
	match := dataURLMediaTypeRe.FindStringSubmatch(token)
	if match == nil {
		return nil, false
	}
	mediaType := normalizeMediaType(match[1])
	if strings.HasPrefix(mediaType, "image/") {
		return map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": token},
		}, true
	}
	payload := token[len(match[0]):]
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}
	return inlineAttachmentPart(&fetchedAttachment{mediaType: mediaType, data: data}), true
}

// joinTextParts concatenates a parts list that holds nothing but text.
func joinTextParts(parts []any) string {
	texts := make([]string, 0, len(parts))
	for _, p := range parts {
		if block, ok := p.(map[string]any); ok {
			t, _ := block["text"].(string)
			texts = append(texts, t)
		}
	}
	return strings.Join(texts, "")
}

// splitLeadingText peels the text parts that precede the first attachment off a
// parts list, returning them joined as the retained system prompt plus the
// remainder (first attachment onward) for the re-homed user message.
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
