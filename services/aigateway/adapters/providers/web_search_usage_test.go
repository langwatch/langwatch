package providers

// Server-side web searches are billed per query on top of the tokens, so
// every lane that reads usage has to count them.

import (
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestUsageFromRawJSON_ReadsAnthropicWebSearchRequests(t *testing.T) {
	body := `{"type":"message","usage":{"input_tokens":120,"output_tokens":30,
		"server_tool_use":{"web_search_requests":2}}}`

	u := usageFromRawJSON([]byte(body), domain.RequestTypeMessages)

	assert.Equal(t, 2, u.WebSearchRequests)
	assert.Equal(t, 120, u.PromptTokens)
}

func TestUsageFromRawJSON_CountsResponsesWebSearchCalls(t *testing.T) {
	body := `{"output":[
		{"type":"web_search_call","id":"ws_1","status":"completed"},
		{"type":"web_search_call","id":"ws_2","status":"completed"},
		{"type":"message","id":"msg_1"}],
		"usage":{"input_tokens":10,"output_tokens":5}}`

	u := usageFromRawJSON([]byte(body), domain.RequestTypeResponses)

	assert.Equal(t, 2, u.WebSearchRequests)
}

func TestUsageFromRawJSON_NoSearchesIsZero(t *testing.T) {
	body := `{"output":[{"type":"message"}],"usage":{"input_tokens":10,"output_tokens":5}}`

	assert.Equal(t, 0, usageFromRawJSON([]byte(body), domain.RequestTypeResponses).WebSearchRequests)
}

func TestExtractResponsesUsage_CountsWebSearchCalls(t *testing.T) {
	search := bfschemas.ResponsesMessageTypeWebSearchCall
	message := bfschemas.ResponsesMessageTypeMessage
	resp := &bfschemas.BifrostResponsesResponse{
		Output: []bfschemas.ResponsesMessage{{Type: &search}, {Type: &message}, {Type: &search}, {Type: &search}},
		Usage:  &bfschemas.ResponsesResponseUsage{InputTokens: 50, OutputTokens: 20, TotalTokens: 70},
	}

	u := extractResponsesUsage(resp)

	assert.Equal(t, 3, u.WebSearchRequests)
	assert.Equal(t, 50, u.PromptTokens)
}

func TestParseAnthropicPassthroughUsage_MessageDeltaCarriesWebSearchRequests(t *testing.T) {
	body := []byte("event: message_delta\n" +
		`data: {"type":"message_delta","usage":{"output_tokens":88,"server_tool_use":{"web_search_requests":4}}}` +
		"\n\n")

	u, ok := parseAnthropicPassthroughUsage(body)

	assert.True(t, ok)
	assert.Equal(t, 4, u.WebSearchRequests)
	assert.Equal(t, 88, u.CompletionTokens)
}

func TestMergePassthroughUsage_KeepsTheWebSearchCount(t *testing.T) {
	it := &bifrostStreamIterator{}
	it.mergePassthroughUsage(domain.Usage{PromptTokens: 10, WebSearchRequests: 2})
	it.mergePassthroughUsage(domain.Usage{CompletionTokens: 7})

	assert.Equal(t, 2, it.Usage().WebSearchRequests, "a later chunk without searches must not clear the count")
}
