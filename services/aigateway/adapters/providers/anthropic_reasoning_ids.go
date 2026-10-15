package providers

import (
	"strings"

	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// reasoningDataPrefix marks a redacted_thinking `data` value minted by the
// translated /v1/messages lane: `lwrs:<reasoning item id>:<encrypted content>`.
//
// OpenAI binds a reasoning item's encrypted_content to the item id it was
// issued under and refuses the pair when the id differs ("Encrypted content
// item_id did not match the target item id"). An Anthropic redacted_thinking
// block has no id field, and the vendored converter gives every incoming one a
// fresh random `rs_` id, so the second turn of any conversation with reasoning
// failed. The id travels inside `data` instead, which Anthropic clients treat
// as opaque and send back verbatim. No base64 alphabet contains ':', so the
// prefix cannot collide with data minted by Anthropic itself.
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
		sealBlockReasoningData(&content[i], ids[blockData(&content[i])])
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

// sealStreamReasoningData seals the redacted_thinking block a stream event
// opens, using the id of the reasoning item that produced the event.
func sealStreamReasoningData(resp *bfschemas.BifrostResponsesStreamResponse, ev *bfanthropic.AnthropicStreamEvent) {
	if resp == nil || resp.Item == nil || resp.Item.ID == nil || ev == nil || ev.ContentBlock == nil {
		return
	}
	sealBlockReasoningData(ev.ContentBlock, *resp.Item.ID)
}

func sealBlockReasoningData(block *bfanthropic.AnthropicContentBlock, itemID string) {
	if block.Type != bfanthropic.AnthropicContentBlockTypeRedactedThinking || block.Data == nil {
		return
	}
	block.Data = bfschemas.Ptr(sealReasoningData(itemID, *block.Data))
}

func blockData(block *bfanthropic.AnthropicContentBlock) string {
	if block.Data == nil {
		return ""
	}
	return *block.Data
}
