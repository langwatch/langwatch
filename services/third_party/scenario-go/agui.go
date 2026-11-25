package scenario

import (
	"encoding/base64"
	"encoding/binary"
	"strings"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

// aguiRow is one message of the flattened AG-UI message list LangWatch
// ingests. A model message maps to one row, except a tool message, which maps
// to one row per tool result (the Go model carries one result per message).
type aguiRow struct {
	id   string
	role Role
	// json is the complete AG-UI message object.
	json []byte
	// text is the content when it is a plain string; textContent reports it.
	text        string
	textContent bool
	traceID     string
	toolCalls   []ToolCall
}

// aguiRows converts a message to its AG-UI rows. The Go model carries one
// tool result per message, so it is always the one row of aguiRowOf.
func aguiRows(m Message) []aguiRow { return []aguiRow{aguiRowOf(m)} }

// aguiRowOf converts a message to its AG-UI row, mirroring the JS
// convertModelMessagesToAguiMessages: trace_id first, then id, role, content
// and toolCalls / toolCallId. Audio file parts become OpenAI input_audio parts
// (raw PCM16 is wrapped in WAV) so the LangWatch ingest externalizes them.
func aguiRowOf(m Message) aguiRow {
	id := m.ID
	if id == "" {
		id = generateMessageID()
	}
	if m.Role == RoleTool {
		id += "-0"
	}
	b := make([]byte, 0, 96+len(m.Content))
	b = append(b, '{')
	if m.TraceID != "" {
		b = append(b, `"trace_id":`...)
		b = jsjson.AppendString(b, m.TraceID)
		b = append(b, ',')
	}
	b = append(b, `"id":`...)
	b = jsjson.AppendString(b, id)
	b = append(b, `,"role":`...)
	b = jsjson.AppendString(b, string(m.Role))

	row := aguiRow{id: id, role: m.Role, traceID: m.TraceID}
	switch {
	case m.Role == RoleTool:
		b = append(b, `,"toolCallId":`...)
		b = jsjson.AppendString(b, m.ToolCallID)
		b = append(b, `,"content":`...)
		value := string(appendToolOutputValue(nil, m.Text()))
		b = jsjson.AppendString(b, value)
		row.text, row.textContent = value, true
	case m.Role == RoleSystem || m.isPlainText():
		b = append(b, `,"content":`...)
		text := m.Text()
		b = jsjson.AppendString(b, text)
		row.text, row.textContent = text, true
	default:
		b = append(b, `,"content":`...)
		var isText bool
		b, row.text, isText = appendNormalizedParts(b, m.contentParts())
		row.textContent = isText
		if m.Role == RoleAssistant && len(m.ToolCalls) > 0 {
			b = append(b, `,"toolCalls":[`...)
			for i, tc := range m.ToolCalls {
				if i > 0 {
					b = append(b, ',')
				}
				b = append(b, `{"id":`...)
				b = jsjson.AppendString(b, tc.ID)
				b = append(b, `,"type":"function","function":{"name":`...)
				b = jsjson.AppendString(b, tc.Name)
				b = append(b, `,"arguments":`...)
				b = jsjson.AppendString(b, toolArgumentsString(tc.Arguments))
				b = append(b, "}}"...)
			}
			b = append(b, ']')
			row.toolCalls = m.ToolCalls
		}
	}
	row.json = append(b, '}')
	return row
}

// toolArgumentsString is JSON.stringify(input) of the parsed arguments.
func toolArgumentsString(args string) string {
	return string(appendToolInput(nil, args))
}

// appendNormalizedParts appends AG-UI content for a part list: a single text
// part collapses to its string, otherwise the (audio-translated) array. It
// also returns the concatenated text parts and whether there were any.
func appendNormalizedParts(b []byte, parts []Part) ([]byte, string, bool) {
	if len(parts) == 1 && parts[0].Type == PartText {
		return jsjson.AppendString(b, parts[0].Text), parts[0].Text, true
	}
	b = append(b, '[')
	var text strings.Builder
	hasText := false
	for i, p := range parts {
		if i > 0 {
			b = append(b, ',')
		}
		if p.Type == PartText {
			text.WriteString(p.Text)
			hasText = true
		}
		if p.IsAudio() && p.URL == "" {
			b = appendInputAudioPart(b, p)
			continue
		}
		b = appendModelPart(b, p, false)
	}
	// The display text of a multipart message is its text parts alone (the
	// transcript of an audio turn), never media payloads.
	return append(b, ']'), text.String(), hasText
}

// appendInputAudioPart writes an audio file part as an OpenAI input_audio
// part. Raw PCM16 is not browser playable, so it ships WAV-wrapped.
func appendInputAudioPart(b []byte, p Part) []byte {
	b = append(b, `{"type":"input_audio","input_audio":{"data":"`...)
	if p.MediaType == MediaTypePCM16 {
		b = appendWAVBase64(b, p.Data)
		b = append(b, `","format":"wav","mimeType":"audio/wav"}}`...)
		return b
	}
	b = base64.StdEncoding.AppendEncode(b, p.Data)
	b = append(b, '"')
	if format := audioFormat(p.MediaType); format != "" {
		b = append(b, `,"format":"`...)
		b = append(b, format...)
		b = append(b, '"')
	}
	b = append(b, `,"mimeType":`...)
	b = jsjson.AppendString(b, p.MediaType)
	return append(b, "}}"...)
}

func audioFormat(mediaType string) string {
	switch strings.ToLower(mediaType) {
	case "audio/wav", "audio/x-wav":
		return "wav"
	case "audio/mpeg":
		return "mp3"
	case "audio/flac":
		return "flac"
	case "audio/ogg":
		return "ogg"
	case "audio/webm":
		return "webm"
	}
	return ""
}

// PCM16 canonical format: 24 kHz, mono, 16-bit.
const (
	pcm16SampleRate  = 24000
	pcm16Channels    = 1
	pcm16SampleWidth = 2
)

// WAVFromPCM16 wraps raw canonical PCM16 audio (24 kHz, mono) in a WAV
// container, for providers that accept WAV but not raw PCM.
func WAVFromPCM16(pcm []byte) []byte {
	h := wavHeader(len(pcm))
	out := make([]byte, 0, len(h)+len(pcm))
	return append(append(out, h[:]...), pcm...)
}

// appendWAVBase64 appends base64(wavHeader + pcm) without copying pcm: base64
// blocks are 3 bytes, so the 44-byte header splits into 42 bytes plus 2 that
// pair with the first payload byte.
func appendWAVBase64(b []byte, pcm []byte) []byte {
	h := wavHeader(len(pcm))
	enc := base64.StdEncoding
	b = enc.AppendEncode(b, h[:42])
	if len(pcm) == 0 {
		return enc.AppendEncode(b, h[42:])
	}
	b = enc.AppendEncode(b, []byte{h[42], h[43], pcm[0]})
	return enc.AppendEncode(b, pcm[1:])
}

// wavHeader returns the 44-byte RIFF/WAVE header for dataLen bytes of
// canonical PCM16 audio.
func wavHeader(dataLen int) [44]byte {
	var h [44]byte
	blockAlign := pcm16Channels * pcm16SampleWidth
	copy(h[0:], "RIFF")
	binary.LittleEndian.PutUint32(h[4:], uint32(36+dataLen))
	copy(h[8:], "WAVE")
	copy(h[12:], "fmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], 1)
	binary.LittleEndian.PutUint16(h[22:], pcm16Channels)
	binary.LittleEndian.PutUint32(h[24:], pcm16SampleRate)
	binary.LittleEndian.PutUint32(h[28:], uint32(pcm16SampleRate*blockAlign))
	binary.LittleEndian.PutUint16(h[32:], uint16(blockAlign))
	binary.LittleEndian.PutUint16(h[34:], pcm16SampleWidth*8)
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], uint32(dataLen))
	return h
}
