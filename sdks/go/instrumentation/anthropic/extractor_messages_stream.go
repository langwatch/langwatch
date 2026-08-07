package anthropic

import (
	"encoding/json"
	"strings"

	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"

	langwatch "github.com/langwatch/langwatch/sdks/go"
)

// messagesStreamAccumulator reconstructs an Anthropic Messages stream from its
// typed SSE events. The wire format is `event: <type>\ndata: {json}` per event;
// the base strips the `data:` prefix and feeds us each JSON payload, so we
// switch on the payload's own "type" field.
//
// Anthropic streams have NO [DONE] sentinel (IsTerminal always returns false);
// the base ends the stream when the body reaches EOF, having already seen the
// terminal message_stop event. The event sequence is:
//
//   - message_start       — carries message.id + message.model + the initial
//     message.usage (input_tokens, cache_read_input_tokens,
//     cache_creation_input_tokens)
//   - content_block_start  — opens a content block
//   - content_block_delta  — text_delta.text / thinking_delta.thinking /
//     input_json_delta.partial_json
//   - content_block_stop
//   - message_delta        — carries the final usage.output_tokens and
//     delta.stop_reason
//   - message_stop
//   - ping                 — keep-alive, ignored
//   - error                — a mid-stream failure, delivered as SSE
//     `event: error` over an HTTP 200 response; it aborts the generation
//
// Because the transport status is 200, an error event is the ONLY signal that
// the generation failed, so it must not be treated as structural noise: the
// accumulator captures it, stops consuming, and Finish marks the span errored.
type messagesStreamAccumulator struct {
	id         string
	model      string
	stopReason string
	output     strings.Builder
	usage      usage
	haveUsage  bool // a message_start or message_delta supplied usage
	// errType / errMsg come from a mid-stream `error` event; either being set
	// means the generation failed and everything after it is discarded.
	errType string
	errMsg  string
	// toolCalls accumulates streamed tool_use blocks keyed by their content-block
	// index; toolCallOrder preserves first-seen order for deterministic output.
	toolCalls     map[int]*streamToolCall
	toolCallOrder []int
}

// streamToolCall accumulates the fragments of a single streamed tool_use block.
// The id/name arrive on content_block_start; the JSON args are streamed as
// input_json_delta partial_json fragments.
type streamToolCall struct {
	id   string
	name string
	args strings.Builder
}

// IsTerminal reports the stream-terminating sentinel. Anthropic uses typed
// events and never sends "[DONE]", so under normal operation this is false and
// the base ends the stream on EOF. Once an `error` event has been seen the
// generation is over, so the stream is reported terminated and the base stops
// scanning the remaining body.
func (a *messagesStreamAccumulator) IsTerminal(string) bool { return a.failed() }

// failed reports whether a mid-stream error event aborted the generation.
func (a *messagesStreamAccumulator) failed() bool {
	return a.errType != "" || a.errMsg != ""
}

// Consume processes one SSE data payload (the JSON after "data:").
func (a *messagesStreamAccumulator) Consume(dataLine string) {
	if a.failed() {
		return // the generation already failed; anything after it is discarded
	}

	var ev streamEvent
	if err := json.Unmarshal([]byte(dataLine), &ev); err != nil {
		return // never fail the caller's stream on a parse error
	}

	switch ev.Type {
	case "message_start":
		if ev.Message != nil {
			if ev.Message.ID != "" {
				a.id = ev.Message.ID
			}
			if ev.Message.Model != "" {
				a.model = ev.Message.Model
			}
			// message_start carries the input + cache usage; output_tokens here is
			// only a partial estimate and is superseded by message_delta.
			a.usage.inputTokens = ev.Message.Usage.InputTokens
			a.usage.cacheReadInputTokens = ev.Message.Usage.CacheReadInputTokens
			a.usage.cacheCreationInputTokens = ev.Message.Usage.CacheCreationInputTokens
			a.haveUsage = true
		}
	case "content_block_start":
		// A tool_use block opens here, carrying its id + name; the JSON args
		// follow as input_json_delta fragments on this block's index.
		if ev.ContentBlock != nil && ev.ContentBlock.Type == "tool_use" {
			acc := a.toolCallAt(ev.Index)
			if ev.ContentBlock.ID != "" {
				acc.id = ev.ContentBlock.ID
			}
			if ev.ContentBlock.Name != "" {
				acc.name = ev.ContentBlock.Name
			}
		}
	case "content_block_delta":
		if ev.Delta != nil {
			switch ev.Delta.Type {
			case "text_delta":
				a.output.WriteString(ev.Delta.Text)
			case "thinking_delta":
				a.output.WriteString(ev.Delta.Thinking)
			case "input_json_delta":
				// Tool-call argument fragments; accumulated structurally onto the
				// block at this index, not appended to the visible output text.
				a.toolCallAt(ev.Index).args.WriteString(ev.Delta.PartialJSON)
			}
		}
	case "message_delta":
		if ev.Delta != nil && ev.Delta.StopReason != "" {
			a.stopReason = ev.Delta.StopReason
		}
		if ev.Usage != nil {
			// The final, authoritative output token count arrives here.
			a.usage.outputTokens = ev.Usage.OutputTokens
			a.haveUsage = true
			// input / cache tokens may be restated; keep the larger value.
			if ev.Usage.InputTokens > a.usage.inputTokens {
				a.usage.inputTokens = ev.Usage.InputTokens
			}
			if ev.Usage.CacheReadInputTokens > a.usage.cacheReadInputTokens {
				a.usage.cacheReadInputTokens = ev.Usage.CacheReadInputTokens
			}
			if ev.Usage.CacheCreationInputTokens > a.usage.cacheCreationInputTokens {
				a.usage.cacheCreationInputTokens = ev.Usage.CacheCreationInputTokens
			}
		}
	case "error":
		// Anthropic reports mid-stream failures as `event: error` on a 200
		// response. Capture it so the partial generation is not recorded as a
		// success; IsTerminal then stops the base consuming the rest of the body.
		if ev.Error != nil {
			a.errType = ev.Error.Type
			a.errMsg = ev.Error.Message
		}
		if !a.failed() {
			a.errType = "anthropic_stream_error"
		}
	case "message_stop", "content_block_stop", "ping":
		// message_stop / content_block_stop are structural; ping is a keep-alive.
	}
}

// toolCallAt returns the accumulator for the streamed tool_use block at index,
// creating it (and remembering its order) on first sight.
func (a *messagesStreamAccumulator) toolCallAt(index int) *streamToolCall {
	if a.toolCalls == nil {
		a.toolCalls = make(map[int]*streamToolCall)
	}
	acc, ok := a.toolCalls[index]
	if !ok {
		acc = &streamToolCall{}
		a.toolCalls[index] = acc
		a.toolCallOrder = append(a.toolCallOrder, index)
	}
	return acc
}

// assembledParts renders the accumulated output into LangWatch rich content:
// the visible text (if any) followed by the tool_use blocks as tool_call parts,
// in first-seen order. hasToolUse reports whether any tool_use block was seen.
func (a *messagesStreamAccumulator) assembledParts() (parts []langwatch.ChatRichContent, hasToolUse bool) {
	if a.output.Len() > 0 {
		parts = append(parts, langwatch.TextPart(a.output.String()))
	}
	for _, index := range a.toolCallOrder {
		tc := a.toolCalls[index]
		hasToolUse = true
		parts = append(parts, langwatch.ChatRichContent{
			Type:       langwatch.ChatContentTypeToolCall,
			ToolName:   tc.name,
			ToolCallID: tc.id,
			Args:       tc.args.String(),
		})
	}
	return parts, hasToolUse
}

// Finish records the reconstructed response: id, model, the full usage
// breakdown, the stop reason and the accumulated output text (gated by capture).
func (a *messagesStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.id != "" {
		span.SetAttributes(semconv.GenAIResponseID(a.id))
	}
	if a.model != "" {
		span.SetResponseModel(a.model)
	}
	if a.stopReason != "" {
		span.SetGenAIResponseFinishReasons(a.stopReason)
	}
	if a.haveUsage {
		recordUsage(span, a.usage)
	}
	if capture.CaptureOutput() {
		// Record structured chat messages when tool_use blocks were streamed (the
		// common agent case), so they are not discarded; otherwise keep the
		// plain-text path for pure-text responses.
		if parts, hasToolUse := a.assembledParts(); hasToolUse {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
				Role:    langwatch.ChatRoleAssistant,
				Content: parts,
			}})
		} else if a.output.Len() > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, a.output.String())})
		}
	}
	// A mid-stream error event arrives on a 200 response, so nothing before this
	// point marks the span as failed. Record it last, after the partial output
	// and usage, which stay on the span as evidence of how far the call got.
	//
	// SetStatus is the right call to make and is kept, but note it is currently
	// swallowed: the otelhttp base sets codes.Ok when the 200 headers arrive,
	// and the OpenTelemetry SDK will not downgrade Ok to Error. Until the base
	// defers that Ok for streamed bodies, error.type and the exception event are
	// what actually reach the consumer.
	if a.failed() {
		err := &streamError{errType: a.errType, message: a.errMsg}
		span.SetStatus(codes.Error, err.Error())
		span.RecordError(err)
		if a.errType != "" {
			span.SetAttributes(semconv.ErrorTypeKey.String(a.errType))
		}
	}
}

// streamError is a mid-stream Anthropic `error` event as a Go error, so it can
// be recorded on the span like any other failure.
type streamError struct {
	errType string
	message string
}

func (e *streamError) Error() string {
	switch {
	case e.errType == "":
		return e.message
	case e.message == "":
		return e.errType
	default:
		return e.errType + ": " + e.message
	}
}

// streamEvent is the generic shape of an Anthropic SSE event payload. The
// fields are pointers so absence is distinguishable from a zero value.
type streamEvent struct {
	Type         string                   `json:"type"`
	Index        int                      `json:"index"`
	Message      *streamEventMessage      `json:"message"`
	ContentBlock *streamEventContentBlock `json:"content_block"`
	Delta        *streamEventDelta        `json:"delta"`
	Usage        *streamUsage             `json:"usage"`
	Error        *streamEventError        `json:"error"`
}

// streamEventError is the `error` event payload's nested error object, e.g.
// {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}.
type streamEventError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// streamEventContentBlock is the content_block_start payload's nested block. For
// a tool_use block it carries the tool's id + name (the args stream as
// input_json_delta fragments).
type streamEventContentBlock struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// streamEventMessage is the message_start payload's nested message object.
type streamEventMessage struct {
	ID    string      `json:"id"`
	Model string      `json:"model"`
	Usage streamUsage `json:"usage"`
}

// streamEventDelta covers both the content_block_delta deltas (text_delta /
// thinking_delta / input_json_delta) and the message_delta delta (stop_reason).
type streamEventDelta struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	Thinking    string `json:"thinking"`
	PartialJSON string `json:"partial_json"`
	StopReason  string `json:"stop_reason"`
}

// streamUsage is the usage object as it appears on message_start (message.usage)
// and message_delta (usage).
type streamUsage struct {
	InputTokens              int64 `json:"input_tokens"`
	OutputTokens             int64 `json:"output_tokens"`
	CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
}
