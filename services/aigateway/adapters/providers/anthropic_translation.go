package providers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/bytedance/sonic"
	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// isAnthropicWireProvider reports whether the resolved destination speaks the
// Anthropic Messages wire format natively, so a /v1/messages body can be
// raw-forwarded byte-for-byte.
//
// Two provider keys qualify, and both run Bifrost's Anthropic adapter, the
// only one with an Anthropic-native passthrough (POST /v1/messages with
// x-api-key + anthropic-version):
//
//   - the plain Anthropic provider, api.anthropic.com;
//   - the per-endpoint derived keys minted for a self-hosted
//     Anthropic-compatible server, whose base type is Anthropic and whose URL
//     rides on the provider config rather than the key.
//
// Byte identity matters for both: it is what keeps prompt-cache prefixes
// hitting and what preserves `thinking`, `cache_control` and the cache-token
// telemetry the passthrough usage parser reads back off the wire. Matching
// only the plain key would quietly divert every self-hosted endpoint onto the
// translated lane and undo that.
//
// Every other destination gets the translation lane. Bedrock and Vertex host
// Anthropic models but do not expose an Anthropic-shaped HTTP surface: Bedrock
// speaks Converse and its PassthroughStream returns unsupported-operation with
// no fallback, which is why streaming /v1/messages on a Bedrock virtual key
// hangs today. Routing them through the translated lane is what fixes that.
func isAnthropicWireProvider(p bfschemas.ModelProvider) bool {
	return p == bfschemas.Anthropic || strings.HasPrefix(string(p), anthropicCompatPrefix)
}

// anthropicMessageIDCounter backs the synthetic message ids handed to clients
// on the translated lane when the upstream response carries none. Anthropic
// clients treat `message.id` as opaque but require it to be present and stable
// for the duration of one message.
var anthropicMessageIDCounter atomic.Uint64

func syntheticAnthropicMessageID() string {
	return fmt.Sprintf("msg_lwgw_%d", anthropicMessageIDCounter.Add(1))
}

// buildMessagesResponsesRequest parses an Anthropic /v1/messages body into
// Bifrost's neutral Responses request so it can be translated to any provider.
//
// The heavy lifting is vendored: AnthropicMessageRequest.ToBifrostResponsesRequest
// already maps system prompts, tools, tool_choice, thinking, cache_control,
// images and the tool_use/tool_result round trip. What this adds is gateway
// authority over the destination: the virtual key decided the provider and
// model, so both are overwritten after the conversion, and the body's own
// `fallbacks` hint is dropped because the gateway runs its own fallback chain.
func buildMessagesResponsesRequest(
	bfCtx *bfschemas.BifrostContext,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
) (*bfschemas.BifrostResponsesRequest, error) {
	if len(req.Body) == 0 {
		return nil, fmt.Errorf("empty messages request body")
	}

	var anthReq bfanthropic.AnthropicMessageRequest
	if err := sonic.Unmarshal(req.Body, &anthReq); err != nil {
		return nil, fmt.Errorf("parse anthropic messages body: %w", err)
	}
	if len(anthReq.Messages) == 0 {
		return nil, fmt.Errorf("anthropic messages body has no messages")
	}

	bfReq := anthReq.ToBifrostResponsesRequest(bfCtx)
	if bfReq == nil {
		return nil, fmt.Errorf("anthropic messages body could not be converted")
	}

	bfReq.Provider = provider
	bfReq.Model = model
	bfReq.Fallbacks = nil

	return bfReq, nil
}

// --- Anthropic error envelopes ---

// anthropicErrorType maps an HTTP status onto the error `type` string
// Anthropic's API documents. Claude Code and the Anthropic SDKs switch on this
// value to decide retryable-vs-terminal, so a translated-lane failure has to
// name itself in their vocabulary rather than leaking gateway jargon.
func anthropicErrorType(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "invalid_request_error"
	case http.StatusUnauthorized:
		return "authentication_error"
	case http.StatusForbidden:
		return "permission_error"
	case http.StatusNotFound:
		return "not_found_error"
	case http.StatusRequestEntityTooLarge:
		return "request_too_large"
	case http.StatusTooManyRequests:
		return "rate_limit_error"
	case http.StatusServiceUnavailable:
		return "overloaded_error"
	default:
		return "api_error"
	}
}

// anthropicErrorBody renders the Anthropic error envelope
// ({"type":"error","error":{"type":...,"message":...}}). Used for both the
// non-streaming body and the terminal `event: error` SSE frame so a client
// sees one shape regardless of which lane failed.
func anthropicErrorBody(status int, message string) []byte {
	if message == "" {
		message = "the gateway could not complete the request"
	}
	body, err := sonic.Marshal(map[string]any{
		"type": "error",
		"error": map[string]any{
			"type":    anthropicErrorType(status),
			"message": message,
		},
	})
	if err != nil {
		return []byte(`{"type":"error","error":{"type":"api_error","message":"the gateway could not complete the request"}}`)
	}
	return body
}

// anthropicUpstreamError wraps a dispatch failure on the translated lane in an
// Anthropic-shaped envelope. Returning a domain.UpstreamError with Body set
// makes both writers forward it verbatim: writeError for the non-streaming
// path, streamErrorFrame for the SSE path.
func anthropicUpstreamError(status int, message string) *domain.UpstreamError {
	if status <= 0 {
		status = http.StatusBadGateway
	}
	return &domain.UpstreamError{
		StatusCode: status,
		Body:       anthropicErrorBody(status, message),
		Message:    message,
	}
}

// anthropicErrorFromBifrost converts a Bifrost dispatch error into an
// Anthropic-shaped upstream error. The provider's own status is preserved so
// terminal 4xx stay terminal; a zero status (transport failure, timeout) is
// reported as 502 rather than being allowed to surface as a silent stall.
func anthropicErrorFromBifrost(berr *bfschemas.BifrostError) *domain.UpstreamError {
	status := 0
	if berr != nil && berr.StatusCode != nil {
		status = *berr.StatusCode
	}
	return anthropicUpstreamError(status, bfErrorMsg(berr))
}

// --- Streaming: the Anthropic event framing state machine ---

// anthropicSSEFrame serializes one Anthropic stream event into SSE wire bytes.
// Anthropic names the event on the `event:` line as well as inside the JSON
// payload, and clients read the former to pick a decoder.
func anthropicSSEFrame(ev *bfanthropic.AnthropicStreamEvent) []byte {
	if ev == nil || ev.Type == "" {
		return nil
	}
	payload, err := sonic.Marshal(ev)
	if err != nil {
		return nil
	}
	out := make([]byte, 0, len(payload)+len(ev.Type)+16)
	out = append(out, "event: "...)
	out = append(out, ev.Type...)
	out = append(out, "\ndata: "...)
	out = append(out, payload...)
	out = append(out, "\n\n"...)
	return out
}

// anthropicBlockTracker remembers what a content block was opened as, so a
// block that has to be closed or re-opened defensively can be reconstructed.
type anthropicBlockTracker struct {
	toolID   string
	toolName string
	kind     bfanthropic.AnthropicContentBlockType
}

// anthropicStreamFramer turns the loose event stream produced by Bifrost's
// converter into a sequence Claude Code accepts.
//
// The vendored converter (ToAnthropicResponsesStreamResponse) is good at event
// BODIES and unreliable about SEQUENCE, which is the half that hard-fails a
// client. Three gaps it leaves, all of them fatal on the wire:
//
//   - `response.incomplete` and `response.failed` are not in its switch, so a
//     max_tokens-truncated or provider-failed turn converts to nothing at all:
//     no message_delta, no message_stop, and a client that waits forever. This
//     is the same silent hang the raw-forward lane exhibits, arriving by a
//     different road.
//   - Block indices come through as the Responses `output_index`, which is
//     sparse (text takes 0, tool calls start at 1 even when no text block was
//     ever emitted). Anthropic requires contiguous indices from 0, so they are
//     remapped densely in first-seen order.
//   - content_block_start / content_block_stop are emitted only when the
//     upstream shape happens to produce output_item.added / output_item.done.
//     Any delta arriving for an unopened block would otherwise be an orphan.
//
// So the framer owns the invariants and the converter owns the payloads:
// exactly one message_start first, every delta inside a matching
// start/stop pair at a dense index, and exactly one message_delta +
// message_stop at the end, always, including when the upstream channel simply
// closes.
type anthropicStreamFramer struct {
	messageID string
	model     string

	started    bool
	terminated bool
	sentDelta  bool

	denseIndex map[int]int
	nextDense  int
	openBlocks map[int]*anthropicBlockTracker

	stopReason   *bfanthropic.AnthropicStopReason
	stopSequence *string
	usage        *bfanthropic.AnthropicUsage
	// sawToolUse records that the turn opened at least one tool_use block.
	// The chat-to-Responses conversion drops the provider's finish_reason on
	// the terminal event, so a turn that ends in a tool call arrives claiming
	// end_turn. Claude Code branches on stop_reason to decide whether a tool
	// is pending, so the reason is recovered from the content the same way the
	// non-streaming converter does it.
	sawToolUse bool
}

func newAnthropicStreamFramer(messageID, model string) *anthropicStreamFramer {
	if messageID == "" {
		messageID = syntheticAnthropicMessageID()
	}
	return &anthropicStreamFramer{
		messageID:  messageID,
		model:      model,
		denseIndex: map[int]int{},
		openBlocks: map[int]*anthropicBlockTracker{},
	}
}

// dense maps an upstream block index onto the next contiguous Anthropic index.
func (f *anthropicStreamFramer) dense(upstream int) int {
	if idx, ok := f.denseIndex[upstream]; ok {
		return idx
	}
	return f.remap(upstream)
}

// remap points an upstream index at a fresh Anthropic block index. Used when a
// single upstream index has to be split across several Anthropic blocks.
func (f *anthropicStreamFramer) remap(upstream int) int {
	idx := f.nextDense
	f.denseIndex[upstream] = idx
	f.nextDense++
	return idx
}

// blockKindForDelta reports the content-block kind a delta belongs in. The
// second result is false for deltas that do not by themselves determine a kind.
func blockKindForDelta(delta *bfanthropic.AnthropicStreamDelta) (bfanthropic.AnthropicContentBlockType, bool) {
	if delta == nil {
		return "", false
	}
	switch delta.Type {
	case bfanthropic.AnthropicStreamDeltaTypeText:
		return bfanthropic.AnthropicContentBlockTypeText, true
	case bfanthropic.AnthropicStreamDeltaTypeThinking,
		bfanthropic.AnthropicStreamDeltaTypeSignature:
		return bfanthropic.AnthropicContentBlockTypeThinking, true
	case bfanthropic.AnthropicStreamDeltaTypeInputJSON:
		return bfanthropic.AnthropicContentBlockTypeToolUse, true
	default:
		// citations and compaction deltas ride inside a block opened by an
		// explicit content_block_start; they do not imply a kind of their own.
		return "", false
	}
}

// ensureStarted emits message_start once, before anything else can reference
// the message.
func (f *anthropicStreamFramer) ensureStarted(out []*bfanthropic.AnthropicStreamEvent) []*bfanthropic.AnthropicStreamEvent {
	if f.started {
		return out
	}
	f.started = true
	return append(out, &bfanthropic.AnthropicStreamEvent{
		Type: bfanthropic.AnthropicStreamEventTypeMessageStart,
		Message: &bfanthropic.AnthropicMessageResponse{
			ID:      f.messageID,
			Type:    "message",
			Role:    "assistant",
			Model:   f.model,
			Content: []bfanthropic.AnthropicContentBlock{},
			Usage:   &bfanthropic.AnthropicUsage{},
		},
	})
}

// openBlock emits content_block_start for a block that received a delta
// without ever being opened. The block kind is inferred from the delta so the
// synthesized start is type-consistent with the deltas that follow it.
func (f *anthropicStreamFramer) openBlock(
	out []*bfanthropic.AnthropicStreamEvent,
	idx int,
	delta *bfanthropic.AnthropicStreamDelta,
) []*bfanthropic.AnthropicStreamEvent {
	if _, ok := f.openBlocks[idx]; ok {
		return out
	}
	block := &bfanthropic.AnthropicContentBlock{}
	tracker := &anthropicBlockTracker{}
	switch {
	case delta == nil, delta.Type == bfanthropic.AnthropicStreamDeltaTypeText:
		block.Type = bfanthropic.AnthropicContentBlockTypeText
		block.Text = bfschemas.Ptr("")
	case delta.Type == bfanthropic.AnthropicStreamDeltaTypeThinking,
		delta.Type == bfanthropic.AnthropicStreamDeltaTypeSignature:
		block.Type = bfanthropic.AnthropicContentBlockTypeThinking
		block.Thinking = bfschemas.Ptr("")
		block.Signature = bfschemas.Ptr("")
	case delta.Type == bfanthropic.AnthropicStreamDeltaTypeInputJSON:
		// A tool_use block must carry id and name before its arguments can be
		// decoded. Reaching here means the upstream never announced the call,
		// so the ids are synthesized to keep the block well-formed rather than
		// dropping the arguments on the floor.
		block.Type = bfanthropic.AnthropicContentBlockTypeToolUse
		block.ID = bfschemas.Ptr(fmt.Sprintf("toolu_lwgw_%s_%d", f.messageID, idx))
		block.Name = bfschemas.Ptr("tool")
		block.Input = []byte("{}")
	default:
		block.Type = bfanthropic.AnthropicContentBlockTypeText
		block.Text = bfschemas.Ptr("")
	}
	tracker.kind = block.Type
	if block.ID != nil {
		tracker.toolID = *block.ID
	}
	if block.Name != nil {
		tracker.toolName = *block.Name
	}
	f.noteBlockKind(tracker.kind)
	f.openBlocks[idx] = tracker
	return append(out, &bfanthropic.AnthropicStreamEvent{
		Type:         bfanthropic.AnthropicStreamEventTypeContentBlockStart,
		Index:        &idx,
		ContentBlock: block,
	})
}

// closeBlock emits content_block_stop for an open block.
func (f *anthropicStreamFramer) closeBlock(out []*bfanthropic.AnthropicStreamEvent, idx int) []*bfanthropic.AnthropicStreamEvent {
	if _, ok := f.openBlocks[idx]; !ok {
		return out
	}
	delete(f.openBlocks, idx)
	return append(out, &bfanthropic.AnthropicStreamEvent{
		Type:  bfanthropic.AnthropicStreamEventTypeContentBlockStop,
		Index: &idx,
	})
}

// closeAllBlocks closes every still-open block in ascending index order, so the
// stop events stay deterministic and mirror the order the blocks opened in.
func (f *anthropicStreamFramer) closeAllBlocks(out []*bfanthropic.AnthropicStreamEvent) []*bfanthropic.AnthropicStreamEvent {
	for idx := 0; idx < f.nextDense; idx++ {
		out = f.closeBlock(out, idx)
	}
	return out
}

// push normalizes one converter event into a valid sub-sequence.
func (f *anthropicStreamFramer) push(ev *bfanthropic.AnthropicStreamEvent) []*bfanthropic.AnthropicStreamEvent {
	if ev == nil || f.terminated {
		return nil
	}
	var out []*bfanthropic.AnthropicStreamEvent

	switch ev.Type {
	case bfanthropic.AnthropicStreamEventTypeMessageStart:
		if f.started {
			return nil
		}
		f.started = true
		msg := ev.Message
		if msg == nil {
			msg = &bfanthropic.AnthropicMessageResponse{}
		}
		if msg.ID == "" {
			msg.ID = f.messageID
		} else {
			f.messageID = msg.ID
		}
		msg.Type = "message"
		msg.Role = "assistant"
		if msg.Model == "" {
			msg.Model = f.model
		}
		if msg.Content == nil {
			msg.Content = []bfanthropic.AnthropicContentBlock{}
		}
		if msg.Usage == nil {
			msg.Usage = &bfanthropic.AnthropicUsage{}
		}
		ev.Message = msg
		return append(out, ev)

	case bfanthropic.AnthropicStreamEventTypeContentBlockStart:
		out = f.ensureStarted(out)
		if ev.Index == nil {
			ev.Index = bfschemas.Ptr(0)
		}
		idx := f.dense(*ev.Index)
		// A repeated start for a live block means the upstream never closed
		// it; close it now so blocks never nest.
		out = f.closeBlock(out, idx)
		tracker := &anthropicBlockTracker{}
		if ev.ContentBlock != nil {
			tracker.kind = ev.ContentBlock.Type
			if ev.ContentBlock.ID != nil {
				tracker.toolID = *ev.ContentBlock.ID
			}
			if ev.ContentBlock.Name != nil {
				tracker.toolName = *ev.ContentBlock.Name
			}
			f.noteBlockKind(tracker.kind)
		}
		f.openBlocks[idx] = tracker
		ev.Index = &idx
		return append(out, ev)

	case bfanthropic.AnthropicStreamEventTypeContentBlockDelta:
		out = f.ensureStarted(out)
		if ev.Index == nil {
			ev.Index = bfschemas.Ptr(0)
		}
		idx := f.dense(*ev.Index)
		// A block must be the kind its deltas describe. Reasoning models trip
		// this: the upstream conversion opens output index 0 as a text item and
		// then streams thinking deltas at that same index, which would render
		// the model's private reasoning as the visible answer. When the kinds
		// disagree, close the block and start the right one.
		if want, known := blockKindForDelta(ev.Delta); known {
			if tracker, isOpen := f.openBlocks[idx]; isOpen && tracker.kind != want &&
				want != bfanthropic.AnthropicContentBlockTypeToolUse &&
				tracker.kind != bfanthropic.AnthropicContentBlockTypeToolUse {
				out = f.closeBlock(out, idx)
				idx = f.remap(*ev.Index)
			}
		}
		out = f.openBlock(out, idx, ev.Delta)
		ev.Index = &idx
		return append(out, ev)

	case bfanthropic.AnthropicStreamEventTypeContentBlockStop:
		out = f.ensureStarted(out)
		if ev.Index == nil {
			ev.Index = bfschemas.Ptr(0)
		}
		// Only a block that actually opened can close. Resolving an unknown
		// upstream index here would reserve a dense index that never opens,
		// leaving a permanent hole in the sequence the client requires to be
		// contiguous.
		idx, mapped := f.denseIndex[*ev.Index]
		if !mapped {
			return out
		}
		return f.closeBlock(out, idx)

	case bfanthropic.AnthropicStreamEventTypeMessageDelta:
		// Recorded, not forwarded: the terminal pair is emitted once by
		// finish() so a stream can never carry two message_delta events or a
		// message_delta after message_stop.
		if ev.Delta != nil && ev.Delta.StopReason != nil {
			f.stopReason = ev.Delta.StopReason
		}
		if ev.Delta != nil && ev.Delta.StopSequence != nil {
			f.stopSequence = ev.Delta.StopSequence
		}
		if ev.Usage != nil {
			f.usage = ev.Usage
		}
		return nil

	case bfanthropic.AnthropicStreamEventTypeMessageStop:
		return f.finish()

	case bfanthropic.AnthropicStreamEventTypePing:
		// A ping is a keepalive and carries nothing. Synthesizing a
		// message_start for one would burn the real message_start still to
		// come, along with its id and usage, so an early ping is simply
		// dropped.
		if !f.started {
			return nil
		}
		return append(out, ev)

	case bfanthropic.AnthropicStreamEventTypeError:
		out = f.ensureStarted(out)
		f.terminated = true
		return append(out, ev)

	default:
		return nil
	}
}

// noteBlockKind remembers block kinds that carry meaning for the terminal
// stop reason.
func (f *anthropicStreamFramer) noteBlockKind(kind bfanthropic.AnthropicContentBlockType) {
	switch kind {
	case bfanthropic.AnthropicContentBlockTypeToolUse,
		bfanthropic.AnthropicContentBlockTypeServerToolUse,
		bfanthropic.AnthropicContentBlockTypeMCPToolUse:
		f.sawToolUse = true
	default:
		// Every other block kind (text, thinking, tool results, documents,
		// images) says nothing about why the turn ended.
	}
}

// setStopReason records a terminal reason the converter dropped on the floor
// (response.incomplete / response.failed have no case in its switch).
func (f *anthropicStreamFramer) setStopReason(reason bfanthropic.AnthropicStopReason) {
	f.stopReason = &reason
}

func (f *anthropicStreamFramer) setUsage(u *bfanthropic.AnthropicUsage) {
	if u != nil {
		f.usage = u
	}
}

// finish closes the message: every open block stopped, then exactly one
// message_delta carrying stop_reason and usage, then message_stop. Calling it
// twice is a no-op, and it is called both on the upstream's terminal event and
// on channel close, which is what guarantees a client is never left waiting.
func (f *anthropicStreamFramer) finish() []*bfanthropic.AnthropicStreamEvent {
	if f.terminated {
		return nil
	}
	f.terminated = true

	var out []*bfanthropic.AnthropicStreamEvent
	out = f.ensureStarted(out)
	out = f.closeAllBlocks(out)

	if !f.sentDelta {
		f.sentDelta = true
		stop := bfanthropic.AnthropicStopReasonEndTurn
		if f.stopReason != nil {
			stop = *f.stopReason
		}
		// A turn carrying a tool call ends in tool_use, whatever the upstream
		// claimed. Only end_turn is corrected: max_tokens and the other
		// terminal reasons say something the content cannot.
		if stop == bfanthropic.AnthropicStopReasonEndTurn && f.sawToolUse {
			stop = bfanthropic.AnthropicStopReasonToolUse
		}
		delta := &bfanthropic.AnthropicStreamDelta{
			StopReason:   &stop,
			StopSequence: f.stopSequence,
		}
		out = append(out, &bfanthropic.AnthropicStreamEvent{
			Type:  bfanthropic.AnthropicStreamEventTypeMessageDelta,
			Delta: delta,
			Usage: f.usage,
		})
	}

	return append(out, &bfanthropic.AnthropicStreamEvent{
		Type: bfanthropic.AnthropicStreamEventTypeMessageStop,
	})
}

// --- Stream iterator for the translated lane ---

// anthropicTranslatedStreamIterator drives Bifrost's Responses stream and emits
// Anthropic SSE frames. It is a RawFramer: the frames it yields are already
// complete `event:/data:` pairs, so writeSSE forwards them verbatim and adds
// neither a `data: [DONE]` trailer (Anthropic has no such sentinel) nor the
// usage warning frame.
type anthropicTranslatedStreamIterator struct {
	ch    chan *bfschemas.BifrostStreamChunk
	bfCtx *bfschemas.BifrostContext

	framer  *anthropicStreamFramer
	pending [][]byte
	current []byte

	usage domain.Usage
	err   error
	done  bool
	// drained marks that the upstream channel closed and the terminal frames
	// have been queued, so Next stops pulling from a closed channel.
	drained bool
}

func (it *anthropicTranslatedStreamIterator) RawFraming() bool { return true }
func (it *anthropicTranslatedStreamIterator) Chunk() []byte    { return it.current }
func (it *anthropicTranslatedStreamIterator) Usage() domain.Usage {
	return it.usage
}
func (it *anthropicTranslatedStreamIterator) Err() error   { return it.err }
func (it *anthropicTranslatedStreamIterator) Close() error { return nil }

// emit queues the wire bytes for a batch of events.
func (it *anthropicTranslatedStreamIterator) emit(events []*bfanthropic.AnthropicStreamEvent) {
	for _, ev := range events {
		if frame := anthropicSSEFrame(ev); len(frame) > 0 {
			it.pending = append(it.pending, frame)
		}
	}
}

func (it *anthropicTranslatedStreamIterator) Next(ctx context.Context) bool {
	for {
		if len(it.pending) > 0 {
			it.current = it.pending[0]
			it.pending = it.pending[1:]
			return true
		}
		if it.done {
			return false
		}
		if it.drained {
			it.done = true
			return false
		}

		select {
		case <-ctx.Done():
			// The client went away. Close the message locally so nothing
			// downstream observes a half-open stream, then report the error.
			it.err = ctx.Err()
			it.done = true
			return false

		case chunk, ok := <-it.ch:
			if !ok {
				// Upstream closed without a terminal event. finish() supplies
				// the message_delta + message_stop the client is waiting for
				// instead of letting the connection stall.
				it.drained = true
				it.emit(it.framer.finish())
				continue
			}
			if chunk.BifrostError != nil {
				it.emit(it.framer.closeAllBlocks(nil))
				it.err = anthropicErrorFromBifrost(chunk.BifrostError)
				it.drained = true
				continue
			}
			resp := chunk.BifrostResponsesStreamResponse
			if resp == nil {
				continue
			}
			it.consume(resp)
		}
	}
}

// consume converts one Bifrost Responses stream event into framed Anthropic
// events and folds its usage into the running totals.
func (it *anthropicTranslatedStreamIterator) consume(resp *bfschemas.BifrostResponsesStreamResponse) {
	if resp.Response != nil && resp.Response.Usage != nil {
		u := extractResponsesUsage(resp.Response)
		if u.PromptTokens > 0 {
			it.usage.PromptTokens = u.PromptTokens
		}
		if u.CompletionTokens > 0 {
			it.usage.CompletionTokens = u.CompletionTokens
		}
		if u.CacheReadTokens > 0 {
			it.usage.CacheReadTokens = u.CacheReadTokens
		}
		if u.CacheCreationTokens > 0 {
			it.usage.CacheCreationTokens = u.CacheCreationTokens
		}
		if u.TotalTokens > 0 {
			it.usage.TotalTokens = u.TotalTokens
		} else {
			it.usage.TotalTokens = it.usage.PromptTokens + it.usage.CompletionTokens
		}
		it.framer.setUsage(bfanthropic.ConvertBifrostUsageToAnthropicUsage(resp.Response.Usage))
	}

	// Terminal events the vendored converter has no case for. Left to it they
	// convert to nothing, and the client waits for a message_stop that never
	// comes. Map them onto a stop reason and close the message here.
	switch resp.Type {
	case bfschemas.ResponsesStreamResponseTypeIncomplete:
		it.framer.setStopReason(bfanthropic.AnthropicStopReasonMaxTokens)
		it.emit(it.framer.finish())
		return
	case bfschemas.ResponsesStreamResponseTypeFailed:
		msg := "the provider failed the request"
		if resp.Message != nil && *resp.Message != "" {
			msg = *resp.Message
		}
		it.emit(it.framer.closeAllBlocks(nil))
		it.err = anthropicUpstreamError(http.StatusBadGateway, msg)
		it.drained = true
		return
	default:
		// Everything else is a mid-stream event the converter below knows how
		// to map, or one it deliberately ignores.
	}

	for _, ev := range bfanthropic.ToAnthropicResponsesStreamResponse(it.bfCtx, resp) {
		it.emit(it.framer.push(ev))
	}
}

// --- Dispatch entry points ---

// dispatchMessagesTranslated serves a non-streaming /v1/messages request whose
// destination does not speak the Anthropic wire format. The body is translated
// into Bifrost's neutral Responses request, dispatched, and the result is
// re-assembled into an Anthropic message envelope.
func (r *BifrostRouter) dispatchMessagesTranslated(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	bfReq, err := buildMessagesResponsesRequest(bfCtx, req, provider, model)
	if err != nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest, err.Error())
	}

	resp, berr := r.bf.ResponsesRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, anthropicErrorFromBifrost(berr)
	}
	if resp == nil {
		return nil, anthropicUpstreamError(http.StatusBadGateway, "provider returned no response")
	}

	anthResp := bfanthropic.ToAnthropicResponsesResponse(bfCtx, resp)
	if anthResp == nil {
		return nil, anthropicUpstreamError(http.StatusBadGateway, "provider response could not be translated")
	}
	if anthResp.ID == "" {
		anthResp.ID = syntheticAnthropicMessageID()
	}
	if anthResp.Model == "" {
		anthResp.Model = model
	}
	if anthResp.Content == nil {
		anthResp.Content = []bfanthropic.AnthropicContentBlock{}
	}

	body, marshalErr := sonic.Marshal(anthResp)
	if marshalErr != nil {
		return nil, anthropicUpstreamError(http.StatusBadGateway, "provider response could not be encoded")
	}

	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractResponsesUsage(resp),
	}, nil
}

// dispatchMessagesTranslatedStream is the streaming sibling. Bifrost's
// ResponsesStream reaches every provider (natively where one exists, through
// the chat-completions fallback everywhere else), and the framer turns its
// events into the Anthropic union Claude Code validates.
func (r *BifrostRouter) dispatchMessagesTranslatedStream(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (domain.StreamIterator, error) {
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	bfReq, err := buildMessagesResponsesRequest(bfCtx, req, provider, model)
	if err != nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest, err.Error())
	}

	ch, berr := r.bf.ResponsesStreamRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, anthropicErrorFromBifrost(berr)
	}

	return &anthropicTranslatedStreamIterator{
		ch:     ch,
		bfCtx:  bfCtx,
		framer: newAnthropicStreamFramer("", modelForClient(req, model)),
	}, nil
}

// modelForClient picks the model name echoed back to the client. Anthropic
// clients compare it against what they asked for, so the inbound name wins
// when present and the resolved id is the fallback.
func modelForClient(req *domain.Request, resolved string) string {
	if req != nil && req.Model != "" && !strings.Contains(req.Model, "/") {
		return req.Model
	}
	return resolved
}
