package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// A managed-Bedrock credential carries the customer's private runtime endpoint,
// and their IAM policy is commonly conditioned on requests arriving through
// that endpoint. The translated /v1/messages lane must dispatch through it,
// not through the public Bedrock host: an unpinned dispatch either fails with
// a confusing IAM denial or, worse, silently sends traffic the customer
// configured as private over the public internet.
//
// Spec: specs/ai-gateway/messages-translation.feature

func vpceBedrockCred(endpoint string) domain.Credential {
	return domain.Credential{
		ID:         "cred-bedrock-vpce",
		ProviderID: domain.ProviderBedrock,
		Extra: map[string]string{
			"bedrock_runtime_endpoint": endpoint,
			"access_key":               "AKIAEXAMPLE",
			"secret_key":               "secretexample",
			"region":                   "us-east-1",
		},
	}
}

func bfschemasNewCtx() *bfschemas.BifrostContext {
	return bfschemas.NewBifrostContext(context.Background(), time.Time{})
}

func vpceMessagesRequest() *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeMessages,
		Model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
		Body: []byte(`{"model":"claude-3-5-sonnet","max_tokens":256,"system":"be brief",` +
			`"messages":[{"role":"user","content":"what is the answer?"}]}`),
	}
}

// Non-streaming: the request must land on the VPCE host and come back as a
// complete Anthropic message envelope.
//
// @scenario "A managed-Bedrock private endpoint is honored on the translated lane"
func TestMessagesTranslated_BedrockVPCE_DispatchesThroughPrivateEndpoint(t *testing.T) {
	var captured struct {
		host string
		path string
		hit  bool
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.hit = true
		captured.host = r.Host
		captured.path = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"output": {"message": {"role": "assistant", "content": [{"text": "the answer is 42"}]}},
			"stopReason": "end_turn",
			"usage": {"inputTokens": 11, "outputTokens": 7, "totalTokens": 18}
		}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	cred := vpceBedrockCred(srv.URL)
	bfCtx := bfschemasNewCtx()
	bfReq, err := buildMessagesResponsesRequest(bfCtx, vpceMessagesRequest(), mapProvider(cred),
		"anthropic.claude-3-5-sonnet-20240620-v1:0")
	require.NoError(t, err)
	resp, err := router.dispatchMessagesTranslatedBedrockVPCE(
		context.Background(), bfCtx, bfReq,
		"anthropic.claude-3-5-sonnet-20240620-v1:0", cred, srv.URL)
	require.NoError(t, err)

	require.True(t, captured.hit,
		"the request must land on the customer's private endpoint, never the public Bedrock host")
	assert.Contains(t, srv.URL, captured.host,
		"outbound host %q must be the VPC endpoint", captured.host)
	assert.Contains(t, captured.path, "converse", "the Converse API is the translated transport")

	var msg map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &msg))
	assert.Equal(t, "message", msg["type"])
	assert.Equal(t, "assistant", msg["role"])
	assert.Equal(t, "end_turn", msg["stop_reason"])
	content, ok := msg["content"].([]any)
	require.True(t, ok)
	require.Len(t, content, 1)
	block, ok := content[0].(map[string]any)
	require.True(t, ok, "content[0] must be a content block object, got %T", content[0])
	assert.Equal(t, "text", block["type"])
	assert.Equal(t, "the answer is 42", block["text"])

	assert.Equal(t, 11, resp.Usage.PromptTokens, "usage must reach billing")
	assert.Equal(t, 7, resp.Usage.CompletionTokens)
}

// Streaming: the routing property is the same, and an upstream that ends
// without terminal events must still produce a complete Anthropic union
// (message_start through message_stop), because the framer owns the terminal
// guarantee on every lane.
//
// @scenario "A managed-Bedrock private endpoint is honored on the translated lane"
func TestMessagesTranslatedStream_BedrockVPCE_DispatchesThroughPrivateEndpoint(t *testing.T) {
	var captured struct {
		path string
		hit  bool
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.hit = true
		captured.path = r.URL.Path
		// An empty eventstream body: a 200 whose stream carries no events.
		w.Header().Set("Content-Type", "application/vnd.amazon.eventstream")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	cred := vpceBedrockCred(srv.URL)
	streamReq := vpceMessagesRequest()
	streamReq.Body = []byte(strings.Replace(string(streamReq.Body), `"max_tokens"`, `"stream":true,"max_tokens"`, 1))

	bfCtx := bfschemasNewCtx()
	bfReq, err := buildMessagesResponsesRequest(bfCtx, streamReq, mapProvider(cred),
		"anthropic.claude-3-5-sonnet-20240620-v1:0")
	require.NoError(t, err)
	iter, err := router.dispatchMessagesTranslatedBedrockVPCEStream(
		context.Background(), bfCtx, bfReq, streamReq,
		"anthropic.claude-3-5-sonnet-20240620-v1:0", cred, srv.URL)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	events, streamErr := collectAnthropicStream(t, ctx, iter)
	require.NoError(t, ctx.Err(), "the stream must terminate promptly, never stall")
	_ = streamErr

	require.True(t, captured.hit,
		"the streaming request must land on the customer's private endpoint")
	assert.Contains(t, captured.path, "converse-stream")

	require.NotEmpty(t, events, "even an empty upstream stream must produce a complete union")
	types := eventTypes(events)
	assert.Equal(t, "message_start", types[0])
	assert.Equal(t, "message_stop", types[len(types)-1])
}

// Claude Code's thinking request must survive onto the private endpoint. The
// translated reasoning becomes Bedrock's additionalModelRequestFields
// (thinking type + budget) exactly as it does on the public Bedrock lane; a
// VPCE customer silently losing thinking would violate the translation
// contract without any error to notice it by.
//
// @scenario "A managed-Bedrock private endpoint is honored on the translated lane"
func TestMessagesTranslated_BedrockVPCE_PreservesThinking(t *testing.T) {
	var mu sync.Mutex
	var bodies [][]byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"output": {"message": {"role": "assistant", "content": [{"text": "thought about it"}]}},
			"stopReason": "end_turn",
			"usage": {"inputTokens": 11, "outputTokens": 7, "totalTokens": 18}
		}`))
	}))
	defer srv.Close()

	thinkingReq := func() *domain.Request {
		return &domain.Request{
			Type:  domain.RequestTypeMessages,
			Model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
			Body: []byte(`{"model":"claude-3-5-sonnet","max_tokens":2048,` +
				`"thinking":{"type":"enabled","budget_tokens":1500},` +
				`"messages":[{"role":"user","content":"think hard"}]}`),
		}
	}

	router := &BifrostRouter{}
	cred := vpceBedrockCred(srv.URL)
	bfCtx := bfschemasNewCtx()
	bfReq, err := buildMessagesResponsesRequest(bfCtx, thinkingReq(), mapProvider(cred),
		"anthropic.claude-3-5-sonnet-20240620-v1:0")
	require.NoError(t, err)
	_, err = router.dispatchMessagesTranslatedBedrockVPCE(
		context.Background(), bfCtx, bfReq,
		"anthropic.claude-3-5-sonnet-20240620-v1:0", cred, srv.URL)
	require.NoError(t, err)

	mu.Lock()
	require.Len(t, bodies, 1)
	outbound := bodies[0]
	mu.Unlock()
	thinking := gjson.GetBytes(outbound, "additionalModelRequestFields.thinking")
	require.True(t, thinking.Exists(),
		"the translated thinking config must reach the private endpoint, not be silently dropped: %s", outbound)
	assert.Equal(t, "enabled", thinking.Get("type").String())
	assert.GreaterOrEqual(t, thinking.Get("budget_tokens").Int(), int64(1024),
		"the budget must respect Anthropic's minimum, same as the public Bedrock lane")

	// The streaming clone must carry the same fields; a thinking turn that
	// works non-streaming and silently degrades on stream would be maddening
	// to diagnose.
	streamReq := thinkingReq()
	streamReq.Body = []byte(strings.Replace(string(streamReq.Body), `"max_tokens"`, `"stream":true,"max_tokens"`, 1))
	bfStreamReq, err := buildMessagesResponsesRequest(bfCtx, streamReq, mapProvider(cred),
		"anthropic.claude-3-5-sonnet-20240620-v1:0")
	require.NoError(t, err)
	iter, err := router.dispatchMessagesTranslatedBedrockVPCEStream(
		context.Background(), bfCtx, bfStreamReq, streamReq,
		"anthropic.claude-3-5-sonnet-20240620-v1:0", cred, srv.URL)
	require.NoError(t, err)
	t.Cleanup(func() { _ = iter.Close() })

	mu.Lock()
	require.Len(t, bodies, 2)
	streamOutbound := bodies[1]
	mu.Unlock()
	streamThinking := gjson.GetBytes(streamOutbound, "additionalModelRequestFields.thinking")
	require.True(t, streamThinking.Exists(),
		"the streaming Converse input must carry the same thinking config: %s", streamOutbound)
	assert.Equal(t, "enabled", streamThinking.Get("type").String())
	assert.GreaterOrEqual(t, streamThinking.Get("budget_tokens").Int(), int64(1024))
}

// The routing decision itself: a VPCE-bearing Bedrock credential must be
// intercepted before any Bifrost dispatch. The router here has no Bifrost
// instance at all, so if the gate did not run first, the dispatch would panic
// instead of returning the gate's own error.
//
// @scenario "A managed-Bedrock private endpoint is honored on the translated lane"
func TestMessagesTranslated_BedrockVPCE_GateRunsBeforeBifrost(t *testing.T) {
	router := &BifrostRouter{}
	// The endpoint fails validation (not an amazonaws.com host), so the gate
	// must fail closed with an Anthropic-shaped error rather than fall
	// through to a public dispatch.
	cred := vpceBedrockCred("https://attacker.example.com")

	_, err := router.dispatchMessagesTranslated(
		context.Background(), vpceMessagesRequest(), mapProvider(cred),
		"anthropic.claude-3-5-sonnet-20240620-v1:0", cred)
	require.Error(t, err, "an invalid private endpoint must fail closed, never silently reroute")

	var ue *domain.UpstreamError
	require.ErrorAs(t, err, &ue)
	require.NotEmpty(t, ue.Body, "the refusal must be a decodable Anthropic envelope")
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(ue.Body, &envelope))
	assert.Equal(t, "error", envelope["type"])
	detail, ok := envelope["error"].(map[string]any)
	require.True(t, ok, "the error field must be an object, got %T", envelope["error"])
	assert.Contains(t, detail["message"], "amazonaws.com",
		"the error must name the endpoint problem so the customer can fix their config")

	// Streaming takes the same gate.
	_, err = router.dispatchMessagesTranslatedStream(
		context.Background(), vpceMessagesRequest(), mapProvider(cred),
		"anthropic.claude-3-5-sonnet-20240620-v1:0", cred)
	require.Error(t, err, "the streaming lane must fail closed identically")
}
