package providers

import (
	"context"
	"strings"
	"testing"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func azureTestStream(status int, bodies ...string) *azureChatIterator {
	ch := make(chan *bfschemas.BifrostStreamChunk, len(bodies))
	for _, body := range bodies {
		ch <- &bfschemas.BifrostStreamChunk{BifrostPassthroughResponse: &bfschemas.BifrostPassthroughResponse{StatusCode: status, Body: []byte(body), Headers: map[string]string{"Retry-After": "12"}}}
	}
	close(ch)
	return &azureChatIterator{ch: ch}
}

// @scenario "Azure stream failures remain visible"
func TestAzureCompatibilityStreamHTTPError(t *testing.T) {
	it := azureTestStream(429, `{"error":{"message":`, `"slow down","code":"rate_limit"}}`)
	err := it.prepare(context.Background())
	var upstream *domain.UpstreamError
	require.ErrorAs(t, err, &upstream)
	require.Equal(t, 429, upstream.StatusCode)
	require.JSONEq(t, `{"error":{"message":"slow down","code":"rate_limit"}}`, string(upstream.Body))
	require.Equal(t, "12", upstream.Headers["Retry-After"])
	require.False(t, it.Next(context.Background()))
}

func TestAzureCompatibilityStreamSplitFramesAndUsage(t *testing.T) {
	it := azureTestStream(200, ": ping\r\n\r", "\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\r", "\n\r\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":3,\"total_tokens\":10}}\n\ndata: [DONE]\n\n")
	require.NoError(t, it.prepare(context.Background()))
	require.True(t, it.Next(context.Background()))
	var response bfschemas.BifrostChatResponse
	require.NoError(t, sonic.Unmarshal(it.Chunk(), &response))
	require.Len(t, response.Choices, 1)
	require.Contains(t, string(it.Chunk()), "hello")
	require.True(t, it.Next(context.Background()))
	require.Contains(t, string(it.Chunk()), `"prompt_tokens":7`)
	require.False(t, it.Next(context.Background()))
	require.NoError(t, it.Err())
	require.Equal(t, extractUsage(&bfschemas.BifrostChatResponse{Usage: &bfschemas.BifrostLLMUsage{PromptTokens: 7, CompletionTokens: 3, TotalTokens: 10}}), it.Usage())
}

// @scenario "Azure stream failures remain visible"
func TestAzureCompatibilityStreamSSEError(t *testing.T) {
	body := `{"error":{"type":"server_error","code":"content_filter","message":"blocked"}}`
	it := azureTestStream(200, "event: error\ndata: "+body+"\n\n")
	require.False(t, it.Next(context.Background()))
	var upstream *domain.UpstreamError
	require.ErrorAs(t, it.Err(), &upstream)
	require.Equal(t, "blocked", upstream.Message)
	require.Equal(t, "content_filter", upstream.ErrorCode)
	require.JSONEq(t, body, string(upstream.Body))
}

func TestAzureCompatibilityStreamRejectsMalformedInput(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		message string
	}{
		{"invalid JSON", "data: {bad}\n\n", "decode Azure chat stream"},
		{"truncated frame", "data: {\"choices\":[]}", "incomplete Azure stream frame"},
		{"oversized frame", strings.Repeat("x", azureMaxFrameBytes+1), "exceeds"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			it := azureTestStream(200, tc.body)
			require.False(t, it.Next(context.Background()))
			require.ErrorContains(t, it.Err(), tc.message)
		})
	}
}

func TestAzureCompatibilityStreamCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	it := &azureChatIterator{ch: make(chan *bfschemas.BifrostStreamChunk)}
	require.False(t, it.Next(ctx))
	require.ErrorIs(t, it.Err(), context.Canceled)
}

func TestAzureCompatibilityTranscriptionNormalizesContentType(t *testing.T) {
	out := &domain.Response{Body: []byte("spoken words"), Headers: map[string]string{"content-type": "text/plain", "Retry-After": "12"}}
	req := &domain.Request{Type: domain.RequestTypeTranscription, Transcription: &domain.TranscriptionUpload{Params: map[string]string{"response_format": "text"}}}
	require.NoError(t, normalizeAzureCompatibilityResponse(out, req, azureResponseOptions{}))
	require.Equal(t, "application/json", out.Headers["Content-Type"])
	require.NotContains(t, out.Headers, "content-type")
	require.Equal(t, "12", out.Headers["Retry-After"])
	var response bfschemas.BifrostTranscriptionResponse
	require.NoError(t, sonic.Unmarshal(out.Body, &response))
	require.Equal(t, "spoken words", response.Text)
}

func TestAzureCompatibilityStreamClosesSourceAtDone(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	it := azureTestStream(200, "data: [DONE]\n\n")
	it.cancel = cancel
	require.False(t, it.Next(ctx))
	require.NoError(t, it.Err())
	require.ErrorIs(t, ctx.Err(), context.Canceled)
}
