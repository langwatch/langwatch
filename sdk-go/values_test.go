package langwatch

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewTypedValue(t *testing.T) {
	t.Run("when given a string it infers text", func(t *testing.T) {
		tv := NewTypedValue("hello")
		assert.Equal(t, InputOutputTypeText, tv.Type)
		assert.Equal(t, "hello", tv.Value)
	})

	t.Run("when given a struct it infers json", func(t *testing.T) {
		type payload struct {
			A int `json:"a"`
		}
		tv := NewTypedValue(payload{A: 1})
		assert.Equal(t, InputOutputTypeJSON, tv.Type)
	})

	t.Run("when given a map it infers json", func(t *testing.T) {
		tv := NewTypedValue(map[string]any{"a": 1})
		assert.Equal(t, InputOutputTypeJSON, tv.Type)
	})

	t.Run("when given nil it infers json with a nil value", func(t *testing.T) {
		tv := NewTypedValue(nil)
		assert.Equal(t, InputOutputTypeJSON, tv.Type)
		assert.Nil(t, tv.Value)
	})

	t.Run("when given a chat message slice it infers chat_messages", func(t *testing.T) {
		tv := NewTypedValue([]ChatMessage{TextMessage(ChatRoleUser, "hi")})
		assert.Equal(t, InputOutputTypeChatMessages, tv.Type)
	})

	t.Run("when given a single chat message it wraps it in chat_messages", func(t *testing.T) {
		tv := NewTypedValue(TextMessage(ChatRoleUser, "hi"))
		assert.Equal(t, InputOutputTypeChatMessages, tv.Type)
		msgs, ok := tv.Value.([]ChatMessage)
		require.True(t, ok)
		assert.Len(t, msgs, 1)
	})

	t.Run("when given an evaluation result it infers evaluation_result", func(t *testing.T) {
		tv := NewTypedValue(EvaluationResult{Status: EvaluationStatusProcessed})
		assert.Equal(t, InputOutputTypeEvaluationResult, tv.Type)
	})

	t.Run("when given a generic slice it infers list with nested typed values", func(t *testing.T) {
		tv := NewTypedValue([]any{"a", 1})
		assert.Equal(t, InputOutputTypeList, tv.Type)
		items, ok := tv.Value.([]TypedValue)
		require.True(t, ok)
		require.Len(t, items, 2)
		assert.Equal(t, InputOutputTypeText, items[0].Type)
		assert.Equal(t, InputOutputTypeJSON, items[1].Type)
	})

	t.Run("when given a TypedValue it passes it through unchanged", func(t *testing.T) {
		original := TypedValue{Type: InputOutputTypeRaw, Value: "x"}
		assert.Equal(t, original, NewTypedValue(original))
	})

	t.Run("when given a byte slice it infers json rather than a list", func(t *testing.T) {
		raw := []byte{0x1, 0x2, 0x3}
		tv := NewTypedValue(raw)
		// []byte must NOT be reflected into a per-element list; the JSON
		// marshaller base64-encodes it as a string under a json envelope.
		assert.Equal(t, InputOutputTypeJSON, tv.Type)
		assert.Equal(t, raw, tv.Value)

		marshalled, err := json.Marshal(tv)
		require.NoError(t, err)
		_, value := splitEnvelope(t, marshalled)
		assert.JSONEq(t, `"`+base64.StdEncoding.EncodeToString(raw)+`"`, string(value))
	})

	t.Run("when given a non-chat slice it infers list with recursively typed elements", func(t *testing.T) {
		tv := NewTypedValue([]any{"text", map[string]any{"k": "v"}, TextMessage(ChatRoleUser, "hi")})
		assert.Equal(t, InputOutputTypeList, tv.Type)

		items, ok := tv.Value.([]TypedValue)
		require.True(t, ok)
		require.Len(t, items, 3)
		assert.Equal(t, InputOutputTypeText, items[0].Type)
		assert.Equal(t, InputOutputTypeJSON, items[1].Type)
		// A ChatMessage nested inside the list is still recognised and wrapped.
		assert.Equal(t, InputOutputTypeChatMessages, items[2].Type)
	})

	t.Run("when given a typed array it infers list", func(t *testing.T) {
		tv := NewTypedValue([2]string{"a", "b"})
		assert.Equal(t, InputOutputTypeList, tv.Type)
		items, ok := tv.Value.([]TypedValue)
		require.True(t, ok)
		require.Len(t, items, 2)
		assert.Equal(t, InputOutputTypeText, items[0].Type)
	})
}

// splitEnvelope decodes a {"type":...,"value":...} envelope, returning the type
// discriminant and the raw value bytes.
func splitEnvelope(t *testing.T, raw []byte) (string, json.RawMessage) {
	t.Helper()
	var env struct {
		Type  string          `json:"type"`
		Value json.RawMessage `json:"value"`
	}
	require.NoError(t, json.Unmarshal(raw, &env))
	return env.Type, env.Value
}

func TestContentConstructors(t *testing.T) {
	t.Run("TextPart carries the text under the text type", func(t *testing.T) {
		part := TextPart("a question")
		assert.Equal(t, ChatContentTypeText, part.Type)
		assert.Equal(t, "a question", part.Text)
		assert.Nil(t, part.ImageURL)
	})

	t.Run("BinaryURLPart records a filename when supplied", func(t *testing.T) {
		part := BinaryURLPart("audio/mpeg", "https://example.com/a.mp3", "a.mp3")
		assert.Equal(t, "a.mp3", part.Filename)
		assert.Equal(t, "https://example.com/a.mp3", part.URL)
		assert.Empty(t, part.Data)
	})

	t.Run("BinaryRefPart records a filename when supplied", func(t *testing.T) {
		part := BinaryRefPart("application/pdf", "file-123", "doc.pdf")
		assert.Equal(t, "doc.pdf", part.Filename)
		assert.Equal(t, "file-123", part.ID)
		assert.Empty(t, part.Data)
	})

	t.Run("TextMessage builds a string-content message", func(t *testing.T) {
		msg := TextMessage(ChatRoleAssistant, "hello there")
		assert.Equal(t, ChatRoleAssistant, msg.Role)
		assert.Equal(t, "hello there", msg.Content)
		assert.Nil(t, msg.Parts)
	})

	t.Run("MultiContentMessage builds a parts-content message", func(t *testing.T) {
		msg := MultiContentMessage(ChatRoleUser, TextPart("look"), ImageURLPart("https://x/i.png"))
		assert.Equal(t, ChatRoleUser, msg.Role)
		parts, ok := msg.Content.([]ChatRichContent)
		require.True(t, ok)
		require.Len(t, parts, 2)
		assert.Equal(t, ChatContentTypeText, parts[0].Type)
		assert.Equal(t, ChatContentTypeImageURL, parts[1].Type)
	})
}

func TestBinaryPart(t *testing.T) {
	t.Run("when built from bytes it inlines base64 data", func(t *testing.T) {
		raw := []byte{0x1, 0x2, 0x3, 0xff}
		part := BinaryPart("image/png", raw, "shot.png")

		assert.Equal(t, ChatContentTypeBinary, part.Type)
		assert.Equal(t, "image/png", part.MimeType)
		assert.Equal(t, base64.StdEncoding.EncodeToString(raw), part.Data)
		assert.Equal(t, "shot.png", part.Filename)
		assert.Empty(t, part.URL)
		assert.Empty(t, part.ID)
	})

	t.Run("when built from a url it carries no inline data", func(t *testing.T) {
		part := BinaryURLPart("audio/mpeg", "https://example.com/a.mp3")
		assert.Equal(t, ChatContentTypeBinary, part.Type)
		assert.Equal(t, "https://example.com/a.mp3", part.URL)
		assert.Empty(t, part.Data)
		assert.Empty(t, part.ID)
	})

	t.Run("when built from a stored object id it references that id", func(t *testing.T) {
		part := BinaryRefPart("application/pdf", "file-123")
		assert.Equal(t, ChatContentTypeBinary, part.Type)
		assert.Equal(t, "file-123", part.ID)
		assert.Empty(t, part.Data)
		assert.Empty(t, part.URL)
	})
}

func TestBinaryPartSerialization(t *testing.T) {
	t.Run("a multimodal message marshals binary parts with the canonical shape", func(t *testing.T) {
		msg := MultiContentMessage(ChatRoleUser,
			TextPart("what is this?"),
			BinaryPart("image/png", []byte("PNGDATA")),
		)
		tv := TypedValue{Type: InputOutputTypeChatMessages, Value: []ChatMessage{msg}}

		raw, err := json.Marshal(tv)
		require.NoError(t, err)

		var decoded struct {
			Type  string `json:"type"`
			Value []struct {
				Role    string `json:"role"`
				Content []struct {
					Type     string `json:"type"`
					Text     string `json:"text"`
					MimeType string `json:"mimeType"`
					Data     string `json:"data"`
				} `json:"content"`
			} `json:"value"`
		}
		require.NoError(t, json.Unmarshal(raw, &decoded))

		assert.Equal(t, "chat_messages", decoded.Type)
		require.Len(t, decoded.Value, 1)
		require.Len(t, decoded.Value[0].Content, 2)
		assert.Equal(t, "text", decoded.Value[0].Content[0].Type)
		assert.Equal(t, "binary", decoded.Value[0].Content[1].Type)
		assert.Equal(t, "image/png", decoded.Value[0].Content[1].MimeType)
		assert.Equal(t, base64.StdEncoding.EncodeToString([]byte("PNGDATA")), decoded.Value[0].Content[1].Data)
	})
}

func TestImageURLPart(t *testing.T) {
	t.Run("when given a detail it records the hint", func(t *testing.T) {
		part := ImageURLPart("https://example.com/i.png", ImageDetailHigh)
		require.NotNil(t, part.ImageURL)
		assert.Equal(t, ChatContentTypeImageURL, part.Type)
		assert.Equal(t, "https://example.com/i.png", part.ImageURL.URL)
		assert.Equal(t, ImageDetailHigh, part.ImageURL.Detail)
	})

	t.Run("when given no detail it omits the hint", func(t *testing.T) {
		part := ImageURLPart("https://example.com/i.png")
		require.NotNil(t, part.ImageURL)
		assert.Empty(t, part.ImageURL.Detail)
	})
}
