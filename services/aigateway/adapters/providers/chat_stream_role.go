package providers

import (
	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// chatDeltaRoleAssistant is the role OpenAI stamps on the first delta of every
// streamed chat completion choice.
const chatDeltaRoleAssistant = "assistant"

// ensureLeadingRoleDelta restores the role-carrying first delta on a streamed
// chat completion.
//
// api.openai.com opens every streamed choice with
// `"delta":{"role":"assistant","content":""}` before any content arrives.
// Bifrost's stream handler forwards a chunk only when its delta carries
// content, reasoning, audio or tool calls, so that opening chunk matches
// nothing and is consumed internally; the first chunk the gateway emits is a
// content delta with no role. Clients that key their accumulator off the
// opening role delta then index a message that was never created (the
// python-sdk streaming tracer died with KeyError: 0 on exactly this).
//
// The repair happens here, in the gateway's own iterator layer, on the first
// delta-carrying chunk observed per choice index: if that delta has no role,
// it gains `"role":"assistant"`. Per choice, not per stream, because n>1
// requests interleave choices and each one opens independently. A provider
// that does send the role itself (self-hosted OpenAI-compatible servers often
// do) passes through untouched: the role is present, so nothing is injected,
// and later chunks are never inspected again for that choice, so no second
// role can appear.
//
// Everything else is deliberately out of reach. Usage-only final chunks carry
// no choices and fall straight through, chunks whose choice has no delta
// object are not given one (only the delta of the first chunk per choice may
// gain a field), and after every choice has been seen the per-chunk cost is a
// map lookup per choice.
func (it *bifrostStreamIterator) ensureLeadingRoleDelta(resp *bfschemas.BifrostChatResponse) {
	if resp == nil {
		return
	}
	for i := range resp.Choices {
		choice := &resp.Choices[i]
		// The nil check on the embedded pointer is load-bearing: promoted
		// field access through a nil embedded struct panics.
		if choice.ChatStreamResponseChoice == nil || choice.Delta == nil {
			continue
		}
		if it.roleSeenByChoice == nil {
			it.roleSeenByChoice = make(map[int]bool, 1)
		}
		if it.roleSeenByChoice[choice.Index] {
			continue
		}
		it.roleSeenByChoice[choice.Index] = true
		if choice.Delta.Role == nil {
			choice.Delta.Role = bfschemas.Ptr(chatDeltaRoleAssistant)
		}
	}
}
