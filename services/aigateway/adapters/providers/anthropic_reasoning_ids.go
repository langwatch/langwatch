package providers

import (
	"strings"

	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// reasoningDataPrefix marks redacted_thinking data minted by the translated
// lane: `lwrs:<reasoning item id>:<encrypted content>`. OpenAI only accepts
// encrypted reasoning under the item id it was issued with, and the block has
// no id field. Spec: specs/ai-gateway/messages-translation.feature
const reasoningDataPrefix = "lwrs:"

// sealReasoningData returns the redacted_thinking data that carries itemID
// alongside the encrypted content.
func sealReasoningData(itemID, encrypted string) string {
	if itemID == "" || encrypted == "" || strings.HasPrefix(encrypted, reasoningDataPrefix) {
		return encrypted
	}
	return reasoningDataPrefix + itemID + ":" + encrypted
}

// openReasoningData splits sealed redacted_thinking data back into the
// reasoning item id and the encrypted content. ok is false for data the
// gateway did not seal.
func openReasoningData(data string) (itemID, encrypted string, ok bool) {
	rest, found := strings.CutPrefix(data, reasoningDataPrefix)
	if !found {
		return "", "", false
	}
	itemID, encrypted, found = strings.Cut(rest, ":")
	if !found || itemID == "" || encrypted == "" {
		return "", "", false
	}
	return itemID, encrypted, true
}

// restoreReasoningItemIDs gives every reasoning input item converted from a
// sealed redacted_thinking block its original id and bare encrypted content.
func restoreReasoningItemIDs(bfReq *bfschemas.BifrostResponsesRequest) {
	if bfReq == nil {
		return
	}
	for i := range bfReq.Input {
		reasoning := encryptedReasoning(&bfReq.Input[i])
		if reasoning == nil {
			continue
		}
		itemID, encrypted, ok := openReasoningData(*reasoning.EncryptedContent)
		if !ok {
			continue
		}
		bfReq.Input[i].ID = bfschemas.Ptr(itemID)
		reasoning.EncryptedContent = bfschemas.Ptr(encrypted)
	}
}

// encryptedReasoning returns the reasoning payload of a reasoning item that
// carries encrypted content, or nil for any other item.
func encryptedReasoning(item *bfschemas.ResponsesMessage) *bfschemas.ResponsesReasoning {
	if item.Type == nil || *item.Type != bfschemas.ResponsesMessageTypeReasoning {
		return nil
	}
	reasoning := item.ResponsesReasoning
	if reasoning == nil || reasoning.EncryptedContent == nil {
		return nil
	}
	return reasoning
}

// sealResponseReasoningData seals the redacted_thinking blocks of a
// non-streaming reply. Each block is matched to the reasoning output item
// whose encrypted content it carries.
func sealResponseReasoningData(resp *bfschemas.BifrostResponsesResponse, content []bfanthropic.AnthropicContentBlock) {
	if resp == nil {
		return
	}
	ids := map[string]string{}
	for i := range resp.Output {
		reasoning := encryptedReasoning(&resp.Output[i])
		if reasoning == nil || resp.Output[i].ID == nil {
			continue
		}
		ids[*reasoning.EncryptedContent] = *resp.Output[i].ID
	}
	for i := range content {
		sealBlockReasoningData(&content[i], ids[blockData(&content[i])], blockData(&content[i]))
	}
}

// exposeEncryptedReasoning clears the empty summary and content lists of
// reasoning output items that carry encrypted content. The vendored converter
// only falls back to a redacted_thinking block when both are nil, and OpenAI
// sends both as empty arrays, so the reasoning was dropped from the reply.
func exposeEncryptedReasoning(resp *bfschemas.BifrostResponsesResponse) {
	if resp == nil {
		return
	}
	for i := range resp.Output {
		item := &resp.Output[i]
		reasoning := encryptedReasoning(item)
		if reasoning == nil || len(reasoning.Summary) > 0 {
			continue
		}
		if item.Content != nil && len(item.Content.ContentBlocks) > 0 {
			continue
		}
		reasoning.Summary = nil
		item.Content = nil
	}
}

// heldReasoning is a redacted_thinking block opened by output_item.added,
// kept back until output_item.done brings the completed encrypted content.
type heldReasoning struct {
	itemID string
	block  *bfanthropic.AnthropicContentBlock
	events []*bfanthropic.AnthropicStreamEvent
}

// forward pushes one upstream event's conversions through the framer. A
// redacted_thinking block is held until its reasoning item completes, because
// OpenAI replays only the encrypted content of the completed item.
func (it *anthropicTranslatedStreamIterator) forward(
	resp *bfschemas.BifrostResponsesStreamResponse,
	events []*bfanthropic.AnthropicStreamEvent,
) {
	if it.held != nil {
		it.queueBehindHeldReasoning(resp, events)
		return
	}
	if resp.Type == bfschemas.ResponsesStreamResponseTypeOutputItemAdded && itemID(resp) != "" {
		if block := redactedThinkingStart(events); block != nil {
			sealBlockReasoningData(block, itemID(resp), blockData(block))
			it.held = &heldReasoning{itemID: itemID(resp), block: block, events: events}
			return
		}
	}
	for _, ev := range events {
		it.emit(it.framer.push(ev))
	}
}

// queueBehindHeldReasoning keeps stream order while a reasoning block is held,
// and releases it once its item completes with the final encrypted content.
func (it *anthropicTranslatedStreamIterator) queueBehindHeldReasoning(
	resp *bfschemas.BifrostResponsesStreamResponse,
	events []*bfanthropic.AnthropicStreamEvent,
) {
	it.held.events = append(it.held.events, events...)
	if resp.Type != bfschemas.ResponsesStreamResponseTypeOutputItemDone || itemID(resp) != it.held.itemID {
		return
	}
	if reasoning := encryptedReasoning(resp.Item); reasoning != nil {
		sealBlockReasoningData(it.held.block, it.held.itemID, *reasoning.EncryptedContent)
	}
	it.flushHeldReasoning()
}

func redactedThinkingStart(events []*bfanthropic.AnthropicStreamEvent) *bfanthropic.AnthropicContentBlock {
	for _, ev := range events {
		if ev != nil && ev.ContentBlock != nil && ev.ContentBlock.Type == bfanthropic.AnthropicContentBlockTypeRedactedThinking {
			return ev.ContentBlock
		}
	}
	return nil
}

// flushHeldReasoning releases a held reasoning block and everything queued
// behind it. Terminal paths call it so a block is never lost.
func (it *anthropicTranslatedStreamIterator) flushHeldReasoning() {
	if it.held == nil {
		return
	}
	held := it.held
	it.held = nil
	for _, ev := range held.events {
		it.emit(it.framer.push(ev))
	}
}

func itemID(resp *bfschemas.BifrostResponsesStreamResponse) string {
	if resp == nil || resp.Item == nil || resp.Item.ID == nil {
		return ""
	}
	return *resp.Item.ID
}

func sealBlockReasoningData(block *bfanthropic.AnthropicContentBlock, itemID, encrypted string) {
	if block.Type != bfanthropic.AnthropicContentBlockTypeRedactedThinking || encrypted == "" {
		return
	}
	if _, bare, ok := openReasoningData(encrypted); ok {
		encrypted = bare
	}
	block.Data = bfschemas.Ptr(sealReasoningData(itemID, encrypted))
}

func blockData(block *bfanthropic.AnthropicContentBlock) string {
	if block.Data == nil {
		return ""
	}
	return *block.Data
}
