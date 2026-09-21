package openaiformat

import (
	"encoding/json"
	"strings"

	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"

	langwatch "github.com/langwatch/langwatch/sdks/go"
)

// chatStreamAccumulator reconstructs a Chat Completions stream. Each chunk is a
// "chat.completion.chunk" carrying choices[].delta.content; the stream is
// terminated by a "[DONE]" sentinel and usage (when requested via
// stream_options.include_usage) arrives in the final chunk.
//
// Deltas are accumulated per choice index, because with n > 1 the chunks
// interleave independent candidates and their tool-call indices restart at 0 for
// each of them.
type chatStreamAccumulator struct {
	id                string
	model             string
	systemFingerprint string
	finishReasons     []string
	// legacyText accumulates the legacy /completions streamed answer, which is
	// arbitrary (non-chat) output text rather than a chat message.
	legacyText strings.Builder
	usage      langwatch.GenAIUsage
	// choices accumulates the streamed candidates keyed by their choice index;
	// choiceOrder preserves first-seen order for deterministic output.
	choices     map[int]*streamChoice
	choiceOrder []int
}

// streamChoice accumulates the deltas of a single streamed candidate: its text
// content plus the tool calls keyed by the delta index within that candidate.
type streamChoice struct {
	output        strings.Builder
	toolCalls     map[int]*streamToolCall
	toolCallOrder []int
}

// streamToolCall accumulates the fragments of a single streamed tool call. The
// id/type/name arrive once; the function arguments are streamed incrementally.
type streamToolCall struct {
	id   string
	typ  string
	name string
	args strings.Builder
}

// chatStreamChunk is the subset of a "chat.completion.chunk" we read.
type chatStreamChunk struct {
	ID                string             `json:"id"`
	Model             string             `json:"model"`
	SystemFingerprint string             `json:"system_fingerprint"`
	Choices           []chatStreamChoice `json:"choices"`
	Usage             *usagePayload      `json:"usage"`
}

// chatStreamChoice is one candidate's slice of a chunk. Index identifies the
// candidate it belongs to (always 0 unless n > 1).
type chatStreamChoice struct {
	Index int `json:"index"`
	Delta struct {
		Content   string `json:"content"`
		ToolCalls []struct {
			Index    int    `json:"index"`
			ID       string `json:"id"`
			Type     string `json:"type"`
			Function struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			} `json:"function"`
		} `json:"tool_calls"`
	} `json:"delta"`
	// Legacy streamed text completions carry text on the choice.
	Text         string `json:"text"`
	FinishReason string `json:"finish_reason"`
}

func (a *chatStreamAccumulator) IsTerminal(dataLine string) bool {
	return dataLine == "[DONE]"
}

func (a *chatStreamAccumulator) Consume(dataLine string) {
	var chunk chatStreamChunk
	if err := json.Unmarshal([]byte(dataLine), &chunk); err != nil {
		return
	}

	if a.id == "" && chunk.ID != "" {
		a.id = chunk.ID
	}
	if a.model == "" && chunk.Model != "" {
		a.model = chunk.Model
	}
	if a.systemFingerprint == "" && chunk.SystemFingerprint != "" {
		a.systemFingerprint = chunk.SystemFingerprint
	}

	for _, choice := range chunk.Choices {
		a.consumeChoice(choice)
	}

	if chunk.Usage != nil {
		mergeUsage(&a.usage, chunk.Usage)
	}
}

// consumeChoice folds one chunk's slice of a candidate into that candidate's
// accumulator.
func (a *chatStreamAccumulator) consumeChoice(choice chatStreamChoice) {
	a.legacyText.WriteString(choice.Text)
	if choice.FinishReason != "" {
		a.finishReasons = append(a.finishReasons, choice.FinishReason)
	}

	acc := a.choiceAt(choice.Index)
	acc.output.WriteString(choice.Delta.Content)
	for _, tc := range choice.Delta.ToolCalls {
		call := acc.toolCallAt(tc.Index)
		if tc.ID != "" {
			call.id = tc.ID
		}
		if tc.Type != "" {
			call.typ = tc.Type
		}
		if tc.Function.Name != "" {
			call.name = tc.Function.Name
		}
		call.args.WriteString(tc.Function.Arguments)
	}
}

// choiceAt returns the accumulator for the candidate at index, creating it (and
// remembering its order) on first sight.
func (a *chatStreamAccumulator) choiceAt(index int) *streamChoice {
	if a.choices == nil {
		a.choices = make(map[int]*streamChoice)
	}
	acc, ok := a.choices[index]
	if !ok {
		acc = &streamChoice{}
		a.choices[index] = acc
		a.choiceOrder = append(a.choiceOrder, index)
	}
	return acc
}

// toolCallAt returns the accumulator for this candidate's streamed tool call at
// index, creating it (and remembering its order) on first sight.
func (c *streamChoice) toolCallAt(index int) *streamToolCall {
	if c.toolCalls == nil {
		c.toolCalls = make(map[int]*streamToolCall)
	}
	acc, ok := c.toolCalls[index]
	if !ok {
		acc = &streamToolCall{}
		c.toolCalls[index] = acc
		c.toolCallOrder = append(c.toolCallOrder, index)
	}
	return acc
}

// assembledToolCalls renders this candidate's accumulated streamed tool calls
// into LangWatch ToolCalls, in first-seen order.
func (c *streamChoice) assembledToolCalls() []langwatch.ToolCall {
	if len(c.toolCallOrder) == 0 {
		return nil
	}
	out := make([]langwatch.ToolCall, 0, len(c.toolCallOrder))
	for _, index := range c.toolCallOrder {
		tc := c.toolCalls[index]
		out = append(out, langwatch.ToolCall{
			ID:   tc.id,
			Type: tc.typ,
			Function: langwatch.FunctionCall{
				Name:      tc.name,
				Arguments: tc.args.String(),
			},
		})
	}
	return out
}

// toChatMessage maps an accumulated candidate onto its assistant message. ok is
// false when the candidate streamed no chat content at all (a legacy
// /completions stream, whose answer is accumulated separately).
func (c *streamChoice) toChatMessage() (langwatch.ChatMessage, bool) {
	toolCalls := c.assembledToolCalls()
	if len(toolCalls) == 0 {
		if c.output.Len() == 0 {
			return langwatch.ChatMessage{}, false
		}
		return langwatch.TextMessage(langwatch.ChatRoleAssistant, c.output.String()), true
	}
	return langwatch.ChatMessage{
		Role:      langwatch.ChatRoleAssistant,
		Content:   c.output.String(),
		ToolCalls: toolCalls,
	}, true
}

// assembledMessages renders one assistant message per streamed candidate, in
// first-seen order, so an n > 1 stream keeps its candidates distinct.
func (a *chatStreamAccumulator) assembledMessages() []langwatch.ChatMessage {
	var msgs []langwatch.ChatMessage
	for _, index := range a.choiceOrder {
		if msg, ok := a.choices[index].toChatMessage(); ok {
			msgs = append(msgs, msg)
		}
	}
	return msgs
}

func (a *chatStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.id != "" {
		span.SetAttributes(semconv.GenAIResponseID(a.id))
	}
	if a.model != "" {
		span.SetResponseModel(a.model)
	}
	if a.systemFingerprint != "" {
		span.SetAttributes(semconv.OpenAIResponseSystemFingerprint(a.systemFingerprint))
	}
	span.SetGenAIResponseFinishReasons(dedupe(a.finishReasons)...)
	span.SetGenAIUsage(a.usage)

	if capture.CaptureOutput() {
		if msgs := a.assembledMessages(); len(msgs) > 0 {
			span.SetGenAIOutputMessages(msgs)
		}
		// The legacy /completions streamed answer is not a chat message; record it
		// as arbitrary output text.
		if a.legacyText.Len() > 0 {
			span.SetOutputText(a.legacyText.String())
		}
	}
}
