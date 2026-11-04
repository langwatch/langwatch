package providers

import (
	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
)

// inlineMidConversationSystem keeps role:"system" messages sent after the first
// turn in place, as user text. Bifrost would lift them into top-level system,
// ahead of the history in the cached prefix, so each new one voids the cache.
// Text joins an adjacent user turn because Converse turns must alternate; the
// envelope matches newer Bifrost releases so an upgrade keeps the prefix.
func inlineMidConversationSystem(messages []bfanthropic.AnthropicMessage) []bfanthropic.AnthropicMessage {
	first := 0
	for first < len(messages) && messages[first].Role == bfanthropic.AnthropicMessageRoleSystem {
		first++
	}

	inlined := make([]bfanthropic.AnthropicMessage, first, len(messages))
	copy(inlined, messages[:first])
	var held []bfanthropic.AnthropicContentBlock

	for i := first; i < len(messages); i++ {
		msg := messages[i]
		last := len(inlined) - 1
		switch {
		case msg.Role != bfanthropic.AnthropicMessageRoleSystem:
			if msg.Role == bfanthropic.AnthropicMessageRoleUser {
				msg.Content = insertAfterToolResults(msg.Content, held)
				held = nil
			}
			inlined = append(inlined, msg)
		case inlined[last].Role == bfanthropic.AnthropicMessageRoleUser:
			blocks := append(contentAsBlocks(inlined[last].Content), systemReminderBlocks(msg.Content)...)
			inlined[last].Content = bfanthropic.AnthropicContent{ContentBlocks: blocks}
		default:
			held = append(held, systemReminderBlocks(msg.Content)...)
		}
	}

	if len(held) > 0 {
		inlined = append(inlined, bfanthropic.AnthropicMessage{
			Role:    bfanthropic.AnthropicMessageRoleUser,
			Content: bfanthropic.AnthropicContent{ContentBlocks: held},
		})
	}
	return inlined
}

// systemReminderBlocks renders a system message as wrapped text blocks, keeping
// each block's cache_control so the breakpoint stays on the conversation.
func systemReminderBlocks(content bfanthropic.AnthropicContent) []bfanthropic.AnthropicContentBlock {
	blocks := contentAsBlocks(content)
	wrapped := make([]bfanthropic.AnthropicContentBlock, 0, len(blocks))
	for i := range blocks {
		if blocks[i].Text == nil {
			continue
		}
		text := "<system-reminder>\n" + *blocks[i].Text + "\n</system-reminder>\n"
		wrapped = append(wrapped, bfanthropic.AnthropicContentBlock{
			Type:         bfanthropic.AnthropicContentBlockTypeText,
			Text:         &text,
			CacheControl: blocks[i].CacheControl,
		})
	}
	return wrapped
}

// insertAfterToolResults adds blocks to a user turn behind its leading
// tool_result blocks, which must stay first in the turn that answers a tool_use.
func insertAfterToolResults(
	content bfanthropic.AnthropicContent,
	blocks []bfanthropic.AnthropicContentBlock,
) bfanthropic.AnthropicContent {
	if len(blocks) == 0 {
		return content
	}
	existing := contentAsBlocks(content)
	at := 0
	for at < len(existing) && existing[at].Type == bfanthropic.AnthropicContentBlockTypeToolResult {
		at++
	}
	merged := make([]bfanthropic.AnthropicContentBlock, 0, len(existing)+len(blocks))
	merged = append(merged, existing[:at]...)
	merged = append(merged, blocks...)
	merged = append(merged, existing[at:]...)
	return bfanthropic.AnthropicContent{ContentBlocks: merged}
}

// contentAsBlocks returns message content in its block form.
func contentAsBlocks(content bfanthropic.AnthropicContent) []bfanthropic.AnthropicContentBlock {
	if content.ContentStr == nil {
		return content.ContentBlocks
	}
	return []bfanthropic.AnthropicContentBlock{{
		Type: bfanthropic.AnthropicContentBlockTypeText,
		Text: content.ContentStr,
	}}
}
