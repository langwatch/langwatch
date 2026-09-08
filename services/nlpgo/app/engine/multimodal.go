package engine

import (
	"encoding/base64"
	"net/url"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// attachmentDataURLRe matches an inline data URL of any media type, with the
// optional RFC 2397 parameters (";name=report.pdf") the application adds to
// carry the original file name. The base64 payload match is greedy over the
// base64 alphabet so the whole attachment is captured as one token; templates
// interpolate the URL as a single uninterrupted string. Case-insensitive
// because RFC 2397 allows uppercase in the scheme, media type, parameters, and
// the ";base64" extension token.
var attachmentDataURLRe = regexp.MustCompile(
	`(?i)data:[a-z0-9][a-z0-9!#$&^_+.-]*/[a-z0-9][a-z0-9!#$&^_+.-]*(?:;[a-z0-9!#$&^_+.-]+=[^;,\s]*)*;base64,[A-Za-z0-9+/]+={0,2}`,
)

// splitMessagesWithAttachments rewrites messages whose string content embeds
// attachment data URLs into OpenAI multimodal content-part lists (text part,
// attachment part, text part). Without this the model receives the base64
// bytes as literal text and can only guess what the attachment holds. Messages
// without attachments pass through untouched, as does content that is already
// a parts list.
//
// A system message that gains a non-text part is split further: providers
// reject image, audio and file parts in system-role messages, so the text
// before the first such part stays as the system prompt and everything from it
// onward is re-homed into a user message inserted right after it.
func splitMessagesWithAttachments(messages []app.ChatMessage) []app.ChatMessage {
	out := make([]app.ChatMessage, 0, len(messages))
	for _, m := range messages {
		s, ok := m.Content.(string)
		if !ok {
			out = append(out, m)
			continue
		}
		// One case-insensitive regex scan decides pass-through; a plain
		// Contains guard would miss uppercase schemes (DATA:IMAGE/...),
		// and content without attachments must stay a plain string, never
		// become a single-element parts list.
		matches := attachmentDataURLRe.FindAllStringIndex(s, -1)
		if len(matches) == 0 {
			out = append(out, m)
			continue
		}
		parts := splitAttachmentDataURLs(s, matches)
		if m.Role == "system" {
			out = append(out, rehomeSystemParts(parts)...)
			continue
		}
		m.Content = parts
		out = append(out, m)
	}
	return out
}

// splitAttachmentDataURLs breaks text into a multimodal content-part list:
// every data URL (located by the caller's attachmentDataURLRe matches) becomes
// the content part its media type calls for and the text around it becomes
// {type: text}. Whitespace-only text segments are dropped so adjacent
// attachments do not produce empty parts.
func splitAttachmentDataURLs(text string, matches [][]int) []any {
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
		last = loc[1]
		raw := text[loc[0]:loc[1]]
		att, ok := parseDataURL(raw)
		if !ok {
			appendText(raw)
			continue
		}
		parts = append(parts, contentPartForDataURL(att))
	}
	appendText(text[last:])
	return parts
}

// rehomeSystemParts turns the parts of a system message into the messages that
// replace it: the text before the first attachment stays the system prompt, and
// the attachment onward moves into a user message right after it. Providers
// refuse an image, audio or file part in a system-role message. A parts list
// that is all text needs no move, so it comes back as one system message.
func rehomeSystemParts(parts []any) []app.ChatMessage {
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

// splitLeadingText peels the text parts that precede the first attachment off
// a parts list, returning them joined as the retained system prompt plus the
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

// dataURLAttachment is a parsed inline data URL.
type dataURLAttachment struct {
	mediaType string // lowercase, parameters removed, e.g. "application/pdf"
	name      string // the ";name=" parameter, decoded; empty when absent
	payload   string // the base64 payload
	plain     string // the same data URL with every parameter removed
}

// parseDataURL splits a matched data URL into its media type, its optional
// name parameter and its base64 payload. It reports false for a value that
// carries no ";base64," marker, which the caller keeps as plain text.
func parseDataURL(raw string) (dataURLAttachment, bool) {
	const marker = ";base64,"
	idx := strings.LastIndex(strings.ToLower(raw), marker)
	if idx < 0 || !strings.HasPrefix(strings.ToLower(raw), "data:") {
		return dataURLAttachment{}, false
	}
	segments := strings.Split(raw[len("data:"):idx], ";")
	att := dataURLAttachment{
		mediaType: strings.ToLower(strings.TrimSpace(segments[0])),
		payload:   raw[idx+len(marker):],
	}
	for _, seg := range segments[1:] {
		key, value, found := strings.Cut(seg, "=")
		if found && strings.EqualFold(strings.TrimSpace(key), "name") {
			att.name = decodeAttachmentName(value)
		}
	}
	att.plain = raw
	if len(segments) > 1 {
		// Providers parse the data URL themselves and only the plain form is
		// portable across all of them, so the parameters are dropped once the
		// name is read off them.
		att.plain = "data:" + att.mediaType + marker + att.payload
	}
	return att, true
}

// decodeAttachmentName turns the url-encoded ";name=" parameter into a bare
// file name. Directory components are removed so a name from an untrusted
// source cannot suggest a path to the provider.
func decodeAttachmentName(value string) string {
	decoded, err := url.PathUnescape(strings.TrimSpace(value))
	if err != nil {
		decoded = strings.TrimSpace(value)
	}
	base := path.Base(strings.ReplaceAll(decoded, "\\", "/"))
	if base == "." || base == "/" || base == ".." {
		return ""
	}
	return base
}

// contentPartForDataURL turns a parsed data URL into the content part its
// media type calls for: a picture becomes image_url, a recording becomes
// input_audio, a text document is decoded into the prompt, and everything else
// becomes a file part the provider reads as a document.
func contentPartForDataURL(att dataURLAttachment) map[string]any {
	switch {
	case strings.HasPrefix(att.mediaType, "image/"):
		return map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": att.plain},
		}
	case strings.HasPrefix(att.mediaType, "audio/"):
		return map[string]any{
			"type": "input_audio",
			"input_audio": map[string]any{
				"data":   att.payload,
				"format": audioFormat(att.mediaType),
			},
		}
	case isInlineTextMediaType(att.mediaType):
		if text, ok := decodeTextPayload(att.payload); ok {
			return map[string]any{
				"type": "text",
				"text": attachmentFileName(att) + "\n\n" + text,
			}
		}
	}
	return map[string]any{
		"type": "file",
		"file": map[string]any{
			"filename":  attachmentFileName(att),
			"file_data": att.plain,
		},
	}
}

// attachmentFileName returns the name the provider sees for an attachment: the
// name the application sent, or one built from the media type.
func attachmentFileName(att dataURLAttachment) string {
	if att.name != "" {
		return att.name
	}
	return "attachment" + extensionForMediaType(att.mediaType)
}

// isInlineTextMediaType reports whether a media type is a text document that
// costs nothing to read as text. HTML is excluded: a file input that holds a
// web page is a file the author attached, not prompt text.
func isInlineTextMediaType(mediaType string) bool {
	if mediaType == "text/html" {
		return false
	}
	return strings.HasPrefix(mediaType, "text/") || mediaType == "application/json"
}

// decodeTextPayload decodes a base64 payload that a media type declares to be
// text. It reports false when the bytes are not valid UTF-8, because the
// declared media type can be wrong and unreadable characters must not go into
// the prompt; the caller then sends the attachment as a file instead.
func decodeTextPayload(payload string) (string, bool) {
	data, err := decodeBase64(payload)
	if err != nil || !utf8.Valid(data) {
		return "", false
	}
	return string(data), true
}

// extensionForMediaType gives an attachment with no name of its own a file
// extension the provider can use to recognize the format.
func extensionForMediaType(mediaType string) string {
	switch mediaType {
	case "application/pdf":
		return ".pdf"
	case "application/json":
		return ".json"
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/wav", "audio/wave", "audio/x-wav":
		return ".wav"
	case "text/plain":
		return ".txt"
	case "text/csv":
		return ".csv"
	case "text/html":
		return ".html"
	default:
		return ".bin"
	}
}

// decodeBase64 decodes a data URL payload. The unpadded form is accepted too,
// because not every producer of a data URL pads its payload.
func decodeBase64(payload string) ([]byte, error) {
	if data, err := base64.StdEncoding.DecodeString(payload); err == nil {
		return data, nil
	}
	return base64.RawStdEncoding.DecodeString(strings.TrimRight(payload, "="))
}
