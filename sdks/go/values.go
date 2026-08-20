package langwatch

import (
	"encoding/base64"
	"reflect"
)

// InputOutputType is the discriminant of a typed span input/output value.
//
// It mirrors the LangWatch tracer's SpanInputOutput union. Values are recorded
// under the langwatch.input / langwatch.output attributes as a JSON-encoded
// TypedValue envelope ({"type": <InputOutputType>, "value": <payload>}); the
// trace-processing pipeline unwraps the envelope and remembers the type.
type InputOutputType string

const (
	// InputOutputTypeText is a plain UTF-8 string.
	InputOutputTypeText InputOutputType = "text"
	// InputOutputTypeRaw is an opaque value coerced to a string.
	InputOutputTypeRaw InputOutputType = "raw"
	// InputOutputTypeJSON is any JSON-serialisable value.
	InputOutputTypeJSON InputOutputType = "json"
	// InputOutputTypeChatMessages is a conversation: a slice of ChatMessage.
	// The pipeline derives gen_ai.input.messages / gen_ai.output.messages from it.
	InputOutputTypeChatMessages InputOutputType = "chat_messages"
	// InputOutputTypeList is a heterogeneous list of nested TypedValues.
	InputOutputTypeList InputOutputType = "list"
	// InputOutputTypeGuardrailResult carries an EvaluationResult from a guardrail.
	InputOutputTypeGuardrailResult InputOutputType = "guardrail_result"
	// InputOutputTypeEvaluationResult carries an EvaluationResult from an evaluator.
	InputOutputTypeEvaluationResult InputOutputType = "evaluation_result"
)

// TypedValue is the wire envelope for a typed span input/output value.
//
// It is the Go equivalent of the LangWatch SpanInputOutput discriminated union.
// Construct one directly for full control, or let SetInput / SetOutput infer the
// type from a Go value via NewTypedValue.
type TypedValue struct {
	Type  InputOutputType `json:"type"`
	Value any             `json:"value"`
}

// ChatRole is the author of a chat message.
type ChatRole string

const (
	ChatRoleSystem    ChatRole = "system"
	ChatRoleUser      ChatRole = "user"
	ChatRoleAssistant ChatRole = "assistant"
	ChatRoleFunction  ChatRole = "function"
	ChatRoleTool      ChatRole = "tool"
	ChatRoleUnknown   ChatRole = "unknown"
)

// FunctionCall is a model-requested function invocation.
type FunctionCall struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

// ToolCall is a model-requested tool invocation.
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

// ChatMessage is a single message in a conversation.
//
// Content holds either a plain string or a []ChatRichContent for multimodal
// messages (text, images, and binary attachments). Use TextMessage or
// MultiContentMessage to construct one ergonomically.
type ChatMessage struct {
	Role ChatRole `json:"role,omitempty"`
	// Content is a string or a []ChatRichContent. Leave nil when the message
	// only carries tool calls.
	Content any `json:"content,omitempty"`
	// Parts is the Vercel AI SDK / pi-ai equivalent of multimodal Content.
	Parts            []ChatRichContent `json:"parts,omitempty"`
	FunctionCall     *FunctionCall     `json:"function_call,omitempty"`
	ToolCalls        []ToolCall        `json:"tool_calls,omitempty"`
	ToolCallID       string            `json:"tool_call_id,omitempty"`
	Name             string            `json:"name,omitempty"`
	ReasoningContent string            `json:"reasoning_content,omitempty"`
}

// ChatContentType is the discriminant of a ChatRichContent part.
type ChatContentType string

const (
	ChatContentTypeText       ChatContentType = "text"
	ChatContentTypeImageURL   ChatContentType = "image_url"
	ChatContentTypeToolCall   ChatContentType = "tool_call"
	ChatContentTypeToolResult ChatContentType = "tool_result"
	// ChatContentTypeBinary is an audio/image/video/file attachment. Exactly
	// one of Data (inline base64), URL (external reference) or ID (stored object)
	// should be set. The ingest pipeline externalises inline Data to a stored
	// object and rewrites it to ID + URL.
	ChatContentTypeBinary ChatContentType = "binary"
)

// ImageDetail is the OpenAI image-fidelity hint.
type ImageDetail string

const (
	ImageDetailAuto ImageDetail = "auto"
	ImageDetailLow  ImageDetail = "low"
	ImageDetailHigh ImageDetail = "high"
)

// ImageURL references an image by URL (which may be a data: URI).
type ImageURL struct {
	URL    string      `json:"url"`
	Detail ImageDetail `json:"detail,omitempty"`
}

// ChatRichContent is one part of a multimodal chat message. Populate the fields
// belonging to the chosen Type; the constructors (TextPart, ImageURLPart,
// BinaryPart, …) set them correctly.
type ChatRichContent struct {
	Type ChatContentType `json:"type,omitempty"`

	// type == text
	Text string `json:"text,omitempty"`

	// type == image_url
	ImageURL *ImageURL `json:"image_url,omitempty"`

	// type == tool_call / tool_result
	ToolName   string `json:"toolName,omitempty"`
	ToolCallID string `json:"toolCallId,omitempty"`
	Args       string `json:"args,omitempty"`
	Result     any    `json:"result,omitempty"`

	// type == binary
	MimeType string `json:"mimeType,omitempty"`
	Data     string `json:"data,omitempty"`
	URL      string `json:"url,omitempty"`
	ID       string `json:"id,omitempty"`
	Filename string `json:"filename,omitempty"`
}

// TextPart builds a text content part.
func TextPart(text string) ChatRichContent {
	return ChatRichContent{Type: ChatContentTypeText, Text: text}
}

// ImageURLPart builds an image content part from a URL or data: URI. The
// optional detail hint defaults to "auto" when omitted.
func ImageURLPart(url string, detail ...ImageDetail) ChatRichContent {
	img := &ImageURL{URL: url}
	if len(detail) > 0 {
		img.Detail = detail[0]
	}
	return ChatRichContent{Type: ChatContentTypeImageURL, ImageURL: img}
}

// BinaryPart builds a binary attachment from in-memory bytes, base64-encoding
// them inline. The ingest pipeline externalises the bytes to a stored object.
// Optionally pass a filename.
func BinaryPart(mimeType string, data []byte, filename ...string) ChatRichContent {
	part := ChatRichContent{
		Type:     ChatContentTypeBinary,
		MimeType: mimeType,
		Data:     base64.StdEncoding.EncodeToString(data),
	}
	if len(filename) > 0 {
		part.Filename = filename[0]
	}
	return part
}

// BinaryURLPart builds a binary attachment that points at an already-hosted URL,
// so no bytes are inlined into the trace.
func BinaryURLPart(mimeType, url string, filename ...string) ChatRichContent {
	part := ChatRichContent{Type: ChatContentTypeBinary, MimeType: mimeType, URL: url}
	if len(filename) > 0 {
		part.Filename = filename[0]
	}
	return part
}

// BinaryRefPart builds a binary attachment that references an existing stored
// object by id.
func BinaryRefPart(mimeType, storedObjectID string, filename ...string) ChatRichContent {
	part := ChatRichContent{Type: ChatContentTypeBinary, MimeType: mimeType, ID: storedObjectID}
	if len(filename) > 0 {
		part.Filename = filename[0]
	}
	return part
}

// TextMessage builds a plain-text chat message.
func TextMessage(role ChatRole, text string) ChatMessage {
	return ChatMessage{Role: role, Content: text}
}

// MultiContentMessage builds a multimodal chat message from content parts.
func MultiContentMessage(role ChatRole, parts ...ChatRichContent) ChatMessage {
	return ChatMessage{Role: role, Content: parts}
}

// Money is a currency amount, used by EvaluationResult.Cost.
type Money struct {
	Currency string  `json:"currency"`
	Amount   float64 `json:"amount"`
}

// EvaluationStatus is the outcome status of an evaluation or guardrail.
type EvaluationStatus string

const (
	EvaluationStatusProcessed EvaluationStatus = "processed"
	EvaluationStatusSkipped   EvaluationStatus = "skipped"
	EvaluationStatusError     EvaluationStatus = "error"
)

// EvaluationResult is the outcome of a guardrail or evaluator, recordable as a
// span input/output of type guardrail_result or evaluation_result.
type EvaluationResult struct {
	Status  EvaluationStatus `json:"status"`
	Passed  *bool            `json:"passed,omitempty"`
	Score   *float64         `json:"score,omitempty"`
	Label   string           `json:"label,omitempty"`
	Details string           `json:"details,omitempty"`
	Cost    *Money           `json:"cost,omitempty"`
}

// NewTypedValue infers an InputOutputType from a Go value, mirroring the
// TypeScript SDK's auto-detection:
//
//   - nil                         -> json (null)
//   - string                      -> text
//   - TypedValue                  -> returned as-is (already typed)
//   - ChatMessage / []ChatMessage -> chat_messages
//   - EvaluationResult            -> evaluation_result
//   - any other slice/array       -> list (elements converted recursively)
//   - anything else               -> json
//
// It never fails: an unrepresentable value still yields a JSON envelope.
func NewTypedValue(value any) TypedValue {
	switch v := value.(type) {
	case nil:
		return TypedValue{Type: InputOutputTypeJSON, Value: nil}
	case TypedValue:
		return v
	case string:
		return TypedValue{Type: InputOutputTypeText, Value: v}
	case ChatMessage:
		return TypedValue{Type: InputOutputTypeChatMessages, Value: []ChatMessage{v}}
	case []ChatMessage:
		return TypedValue{Type: InputOutputTypeChatMessages, Value: v}
	case EvaluationResult:
		return TypedValue{Type: InputOutputTypeEvaluationResult, Value: v}
	}

	// Reflect on slices/arrays (other than []byte) to produce a list of nested
	// typed values; everything else is JSON.
	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		if rv.Type().Elem().Kind() == reflect.Uint8 { // []byte -> json/base64 via marshaller
			return TypedValue{Type: InputOutputTypeJSON, Value: value}
		}
		items := make([]TypedValue, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			items[i] = NewTypedValue(rv.Index(i).Interface())
		}
		return TypedValue{Type: InputOutputTypeList, Value: items}
	default:
		return TypedValue{Type: InputOutputTypeJSON, Value: value}
	}
}
