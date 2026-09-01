package providers

// Passthrough streams arrive as raw socket reads, not whole SSE events,
// so a usage-bearing frame can straddle two chunks. These tests drive
// the iterator with Anthropic /v1/messages frames delivered whole and
// split mid-frame, and assert the final Usage still carries the input
// and cache counts from message_start plus the output count from
// message_delta.

import (
	"context"
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const anthropicMessageStartFrame = "event: message_start\n" +
	`data: {"type":"message_start","message":{"id":"msg_x","type":"message",` +
	`"role":"assistant","content":[],"model":"claude-sonnet-4-5","stop_reason":null,` +
	`"usage":{"input_tokens":462,"cache_creation_input_tokens":34434,` +
	`"cache_read_input_tokens":23759,` +
	`"cache_creation":{"ephemeral_5m_input_tokens":33434,"ephemeral_1h_input_tokens":1000},` +
	`"output_tokens":1}}}` + "\n\n"

const anthropicMessageDeltaFrame = "event: message_delta\n" +
	`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},` +
	`"usage":{"output_tokens":88}}` + "\n\n"

func anthropicPassthroughIterator(bodies ...string) *bifrostStreamIterator {
	ch := make(chan *bfschemas.BifrostStreamChunk, len(bodies))
	for _, body := range bodies {
		ch <- &bfschemas.BifrostStreamChunk{
			BifrostPassthroughResponse: &bfschemas.BifrostPassthroughResponse{
				Body: []byte(body),
			},
		}
	}
	close(ch)
	return &bifrostStreamIterator{
		ch:         ch,
		rawFraming: true,
		parseUsage: parseAnthropicPassthroughUsage,
	}
}

func drain(t *testing.T, iter *bifrostStreamIterator) {
	t.Helper()
	for iter.Next(context.Background()) {
	}
	require.NoError(t, iter.Err())
}

func TestStreamIterator_KeepsAnthropicUsageAcrossSeparateFrameChunks(t *testing.T) {
	iter := anthropicPassthroughIterator(
		anthropicMessageStartFrame,
		"event: content_block_delta\n"+
			`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}`+"\n\n",
		anthropicMessageDeltaFrame,
	)
	drain(t, iter)

	usage := iter.Usage()
	assert.Equal(t, 462, usage.PromptTokens)
	assert.Equal(t, 34434, usage.CacheCreationTokens)
	assert.Equal(t, 23759, usage.CacheReadTokens)
	assert.Equal(t, 1000, usage.CacheCreation1hTokens)
	assert.Equal(t, 88, usage.CompletionTokens)
}

// @scenario "A usage report split across stream reads still counts"
func TestStreamIterator_ParsesAnthropicUsageFrameSplitAcrossChunks(t *testing.T) {
	// Split the message_start frame in the middle of its usage JSON: the
	// first read ends inside a token count, the second read finishes the
	// frame. A stateless per-chunk parse loses the whole frame and the
	// stream meters zero input and zero cache writes.
	cut := strings.Index(anthropicMessageStartFrame, `"cache_creation_input_tokens":344`) + len(`"cache_creation_input_tokens":344`)
	require.Greater(t, cut, len(`"cache_creation_input_tokens":344`))
	iter := anthropicPassthroughIterator(
		anthropicMessageStartFrame[:cut],
		anthropicMessageStartFrame[cut:],
		anthropicMessageDeltaFrame,
	)
	drain(t, iter)

	usage := iter.Usage()
	assert.Equal(t, 462, usage.PromptTokens)
	assert.Equal(t, 34434, usage.CacheCreationTokens)
	assert.Equal(t, 23759, usage.CacheReadTokens)
	assert.Equal(t, 1000, usage.CacheCreation1hTokens)
	assert.Equal(t, 88, usage.CompletionTokens)
}

func TestStreamIterator_ParsesFrameSplitTogetherWithTheDeltaRead(t *testing.T) {
	// The closing bytes of message_start and the whole message_delta land
	// in one read, which is what a real socket does near end of stream.
	cut := strings.Index(anthropicMessageStartFrame, `"input_tokens":4`) + len(`"input_tokens":4`)
	iter := anthropicPassthroughIterator(
		anthropicMessageStartFrame[:cut],
		anthropicMessageStartFrame[cut:]+anthropicMessageDeltaFrame,
	)
	drain(t, iter)

	usage := iter.Usage()
	assert.Equal(t, 462, usage.PromptTokens)
	assert.Equal(t, 34434, usage.CacheCreationTokens)
	assert.Equal(t, 88, usage.CompletionTokens)
}

func TestStreamIterator_DropsAPathologicalTailPastTheCap(t *testing.T) {
	// A stream that never closes an SSE frame must not grow the carry
	// buffer without bound: past the cap the tail is dropped and the
	// stream simply reports no usage, as before the carry existed.
	huge := "data: {" + strings.Repeat("x", maxUsageTailBytes)
	iter := anthropicPassthroughIterator(huge, huge)
	drain(t, iter)

	assert.Nil(t, iter.usageTail)
	assert.Zero(t, iter.Usage().PromptTokens)
}

func TestPassthroughUsageTail_KeepsOnlyTheUnterminatedRemainder(t *testing.T) {
	assert.Equal(t, []byte("data: {par"), passthroughUsageTail([]byte("event: a\ndata: {}\n\ndata: {par")))
	assert.Nil(t, passthroughUsageTail([]byte("event: a\ndata: {}\n\n")))
	assert.Equal(t, []byte("data: {par"), passthroughUsageTail([]byte("event: a\r\ndata: {}\r\n\r\ndata: {par")))
	assert.Equal(t, []byte("no terminator yet"), passthroughUsageTail([]byte("no terminator yet")))
}
