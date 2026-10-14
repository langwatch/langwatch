package rules

import "strings"

// JudgeMessage is one string-content chat message of the older judges.
type JudgeMessage struct {
	Role    string
	Content string
}

// JudgeMaxOutputTokens is litellm.get_max_tokens for the recorded models, 0
// when unknown; the older judges trim their messages to it.
// ponytail: a hand table; unknown models are not trimmed, where Python raised for unmapped ones.
func JudgeMaxOutputTokens(model string) int {
	switch model {
	case "gpt-4o-mini", "openai/gpt-4o-mini", "gpt-4o-mini-2024-07-18", "openai/gpt-4o-mini-2024-07-18", "gpt-4o", "openai/gpt-4o":
		return 16_384
	case "gpt-4-turbo", "openai/gpt-4-turbo":
		return 4_096
	case "gpt-5-mini", "openai/gpt-5-mini", "gpt-5", "openai/gpt-5":
		return 128_000
	}
	return 0
}

// countMessages is litellm.token_counter over messages: 3 per message plus
// its role and content, and 3 to prime the reply.
func (c *TokenCounter) countMessages(model string, messages []JudgeMessage) int {
	total := 3
	for _, message := range messages {
		total += 3 + c.Count(model, message.Role) + c.Count(model, message.Content)
	}
	return total
}

// TrimJudgeMessages is litellm's trim_messages with an explicit max_tokens:
// the system prompt first, then the latest messages, each shortened in the middle.
func (c *TokenCounter) TrimJudgeMessages(model string, messages []JudgeMessage, maxTokens int) []JudgeMessage {
	if c.countMessages(model, messages) < maxTokens {
		return messages
	}
	var systemParts []string
	var rest []JudgeMessage
	for _, message := range messages {
		if message.Role == "system" {
			systemParts = append(systemParts, message.Content)
			continue
		}
		rest = append(rest, message)
	}
	if len(systemParts) == 0 {
		return c.trimLatestFirst(model, messages, maxTokens)
	}
	system := JudgeMessage{Role: "system", Content: strings.Join(systemParts, "\n")}
	systemTokens := c.countMessages(model, []JudgeMessage{system})
	if systemTokens > maxTokens {
		system = c.shortenJudgeMessage(model, system, maxTokens)
		systemTokens = c.countMessages(model, []JudgeMessage{system})
	}
	maxTokens -= systemTokens
	if maxTokens == 0 {
		return []JudgeMessage{system}
	}
	return append([]JudgeMessage{system}, c.trimLatestFirst(model, rest, maxTokens)...)
}

// trimLatestFirst is process_messages and attempt_message_addition.
func (c *TokenCounter) trimLatestFirst(model string, messages []JudgeMessage, maxTokens int) []JudgeMessage {
	var kept []JudgeMessage
	for i := len(messages) - 1; i >= 0; i-- {
		available := maxTokens - c.countMessages(model, kept)
		if available <= 3 {
			break
		}
		with := append([]JudgeMessage{messages[i]}, kept...)
		if c.countMessages(model, with) <= maxTokens {
			kept = with
			continue
		}
		shortened := append([]JudgeMessage{c.shortenJudgeMessage(model, messages[i], available)}, kept...)
		if c.countMessages(model, shortened) <= maxTokens {
			kept = shortened
		}
	}
	return kept
}

// shortenJudgeMessage is shorten_message_to_fit_limit: up to 10 cuts of the
// middle, joined with "..". Python's content[-0:] keeps the whole text, kept here.
func (c *TokenCounter) shortenJudgeMessage(model string, message JudgeMessage, tokensNeeded int) JudgeMessage {
	if strings.Contains(model, "gpt") && tokensNeeded <= 10 {
		return message
	}
	for range 10 {
		total := c.countMessages(model, []JudgeMessage{message})
		if total <= tokensNeeded {
			break
		}
		content := []rune(message.Content)
		newLength := max(0, int(float64(len(content))*(float64(tokensNeeded)/float64(total)))-1)
		half := min(newLength/2, len(content))
		right := content
		if half > 0 {
			right = content[len(content)-half:]
		}
		message.Content = string(content[:half]) + ".." + string(right)
	}
	return message
}
