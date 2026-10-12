package scenario

import (
	"encoding/json"
	"slices"
	"strings"
)

// Role is the author of a message.
type Role string

// Message roles.
const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// PartType identifies the kind of a content part.
type PartType string

// Built-in content part types. Other values are custom parts, carried by
// Part.Raw.
const (
	PartText  PartType = "text"
	PartImage PartType = "image"
	PartFile  PartType = "file"
)

// MediaTypePCM16 is the media type of raw 16-bit little-endian PCM audio, the
// canonical in-message audio format (24 kHz, mono).
const MediaTypePCM16 = "audio/pcm16"

// Part is one piece of multimodal message content: text, an image, or a file
// such as audio. Inline payloads go in Data; remote ones in URL.
type Part struct {
	Type PartType
	// Text is the content of a text part.
	Text string
	// MediaType is the IANA media type of an image or file part, for example
	// "image/png", "audio/wav" or MediaTypePCM16.
	MediaType string
	// Data is the inline payload of an image or file part.
	Data []byte
	// URL references the payload of an image or file part instead of Data.
	URL string
	// Filename is an optional name for a file part.
	Filename string
	// Raw is the JSON of a custom part type. It is serialized verbatim and
	// survives cloning, so parts the core does not know are never lost.
	Raw json.RawMessage
}

// TextPart returns a text content part.
func TextPart(text string) Part { return Part{Type: PartText, Text: text} }

// ImagePart returns an inline image part.
func ImagePart(mediaType string, data []byte) Part {
	return Part{Type: PartImage, MediaType: mediaType, Data: data}
}

// ImageURLPart returns an image part that references a URL.
func ImageURLPart(url string) Part { return Part{Type: PartImage, URL: url} }

// FilePart returns an inline file part. Audio is a file part with an audio/*
// media type.
func FilePart(mediaType string, data []byte, filename string) Part {
	return Part{Type: PartFile, MediaType: mediaType, Data: data, Filename: filename}
}

// AudioPart returns an inline audio file part.
func AudioPart(mediaType string, data []byte) Part {
	return Part{Type: PartFile, MediaType: mediaType, Data: data}
}

// IsAudio reports whether p is a file part carrying audio.
func (p Part) IsAudio() bool {
	return p.Type == PartFile && strings.HasPrefix(p.MediaType, "audio/")
}

// ToolCall is a tool invocation requested by the assistant.
type ToolCall struct {
	ID   string
	Name string
	// Arguments is the JSON-encoded argument object.
	Arguments string
}

// Message is a provider-agnostic chat message.
//
// The content of a message is Parts when it has any, otherwise Content. Plain
// text messages only set Content. An assistant message may additionally carry
// ToolCalls; a tool message answers the call ToolCallID with Content.
type Message struct {
	// ID is assigned by the scenario state when the message is added
	// ("scenariomsg_…").
	ID      string
	Role    Role
	Content string
	Parts   []Part
	// ToolCalls are the tool invocations of an assistant message.
	ToolCalls []ToolCall
	// ToolCallID is the call a tool message answers.
	ToolCallID string
	// ToolName is the tool a tool message answers. Optional: when empty it is
	// resolved from the assistant call with the same ToolCallID.
	ToolName string
	// TraceID is the OpenTelemetry trace id of the agent call that produced
	// the message, stamped by the executor.
	TraceID string
	// Turn is the turn the message was added in, stamped by the state.
	Turn int
}

// SystemMsg returns a system message.
func SystemMsg(content string) Message { return Message{Role: RoleSystem, Content: content} }

// UserMsg returns a user message.
func UserMsg(content string) Message { return Message{Role: RoleUser, Content: content} }

// AssistantMsg returns an assistant message.
func AssistantMsg(content string) Message { return Message{Role: RoleAssistant, Content: content} }

// ToolMsg returns a tool result message answering toolCallID.
func ToolMsg(toolCallID, content string) Message {
	return Message{Role: RoleTool, ToolCallID: toolCallID, Content: content}
}

// Text returns the text of the message: Content, or its text parts joined
// with a space when it has parts.
func (m Message) Text() string {
	if len(m.Parts) == 0 {
		return m.Content
	}
	n := 0
	var only string
	for _, p := range m.Parts {
		if p.Type == PartText {
			n++
			only = p.Text
		}
	}
	if n <= 1 {
		return only
	}
	var b strings.Builder
	first := true
	for _, p := range m.Parts {
		if p.Type != PartText {
			continue
		}
		if !first {
			b.WriteByte(' ')
		}
		first = false
		b.WriteString(p.Text)
	}
	return b.String()
}

// HasAudio reports whether the message carries an audio part.
func (m Message) HasAudio() bool {
	for _, p := range m.Parts {
		if p.IsAudio() {
			return true
		}
	}
	return false
}

// contentParts returns the message content as parts: Parts, or Content as a
// single text part when non-empty.
func (m Message) contentParts() []Part {
	if len(m.Parts) > 0 {
		return m.Parts
	}
	if m.Content != "" {
		return []Part{TextPart(m.Content)}
	}
	return nil
}

// isPlainText reports whether the message serializes as a bare string.
func (m Message) isPlainText() bool {
	return len(m.Parts) == 0 && len(m.ToolCalls) == 0 && m.Role != RoleTool
}

// clone returns a copy whose slices do not alias m's, so later appends by the
// caller cannot change a stored message. Payload bytes are shared.
func (m Message) clone() Message {
	m.Parts = slices.Clip(slices.Clone(m.Parts))
	m.ToolCalls = slices.Clip(slices.Clone(m.ToolCalls))
	return m
}
