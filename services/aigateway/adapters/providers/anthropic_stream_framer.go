package providers

import (
	"fmt"

	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// anthropicBlockTracker records the kind a content block was opened as, which
// is what decides whether an arriving delta belongs in it or needs a block of
// its own.
type anthropicBlockTracker struct {
	kind bfanthropic.AnthropicContentBlockType
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
		// it. Close it and give the new block its own index: reusing the index
		// would emit start/stop/start for one index, and a client that
		// accumulates by index would merge two distinct blocks into one.
		if _, live := f.openBlocks[idx]; live {
			out = f.closeBlock(out, idx)
			idx = f.remap(*ev.Index)
		}
		tracker := &anthropicBlockTracker{}
		if ev.ContentBlock != nil {
			tracker.kind = ev.ContentBlock.Type
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
			if tracker, isOpen := f.openBlocks[idx]; isOpen && tracker.kind != want {
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
		// Close open blocks before terminating. finish() short-circuits once
		// terminated is set, so anything still open here would never be closed
		// by any later path and the client would hold a half-built block.
		out = f.ensureStarted(out)
		out = f.closeAllBlocks(out)
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
