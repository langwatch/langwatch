//go:build live_bedrock_vpce

// Live verification of the managed-Bedrock VPCE dispatch against a real
// Bedrock endpoint. Gated behind the `live_bedrock_vpce` build tag and env
// vars so it never runs in normal CI. It exercises the exact production code
// path (buildChatRequest -> ConverseInput mapping -> SDK Converse with
// BaseEndpoint -> response mapping), proving the endpoint override + mapping
// work end to end.
//
// Run (baseline, our own dev creds against the public EU endpoint):
//
//	AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//	BVPCE_ENDPOINT=https://bedrock-runtime.eu-central-1.amazonaws.com \
//	BVPCE_REGION=eu-central-1 \
//	BVPCE_MODEL=eu.anthropic.claude-haiku-4-5-20251001-v1:0 \
//	go test -tags live_bedrock_vpce ./services/aigateway/adapters/providers/ \
//	  -run BedrockVPCELive -count=1 -v
//
// Run (real, managed customer cred against the http VPCE :80): set the STS-
// minted access/secret/session, BVPCE_ENDPOINT=http://vpce-...:80, region,
// and the customer's inference-profile model id.
package providers

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestBedrockVPCELive_Ping(t *testing.T) {
	endpoint := os.Getenv("BVPCE_ENDPOINT")
	if endpoint == "" {
		t.Skip("BVPCE_ENDPOINT not set; skipping live Bedrock VPCE test")
	}
	ak := os.Getenv("AWS_ACCESS_KEY_ID")
	sk := os.Getenv("AWS_SECRET_ACCESS_KEY")
	if ak == "" || sk == "" {
		t.Skip("AWS creds not set; skipping live Bedrock VPCE test")
	}
	region := os.Getenv("BVPCE_REGION")
	if region == "" {
		region = "us-east-1"
	}
	model := os.Getenv("BVPCE_MODEL")
	if model == "" {
		t.Fatal("BVPCE_MODEL must be set (the inference-profile id to invoke)")
	}

	extra := map[string]string{
		"bedrock_runtime_endpoint": endpoint,
		"access_key":               ak,
		"secret_key":               sk,
		"region":                   region,
	}
	if st := os.Getenv("AWS_SESSION_TOKEN"); st != "" {
		extra["session_token"] = st
	}

	cred := domain.Credential{
		ID:         "live-bedrock-vpce",
		ProviderID: domain.ProviderBedrock,
		Extra:      extra,
	}
	req := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body:  []byte(`{"messages":[{"role":"user","content":"reply with the single word: pong"}],"max_tokens":16}`),
	}

	router := &BifrostRouter{}
	resp, err := router.dispatchBedrockVPCE(context.Background(), req, mapProvider(cred.ProviderID), model, cred, endpoint)
	if err != nil {
		t.Fatalf("dispatchBedrockVPCE error: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d; body=%s", resp.StatusCode, string(resp.Body))
	}

	text := gjson.GetBytes(resp.Body, "choices.0.message.content").String()
	finish := gjson.GetBytes(resp.Body, "choices.0.finish_reason").String()
	t.Logf("LIVE 200 via %s | model=%s | text=%q | finish=%q | usage in=%d out=%d",
		endpoint, model, text, finish, resp.Usage.PromptTokens, resp.Usage.CompletionTokens)

	if text == "" {
		t.Fatalf("empty assistant text; body=%s", string(resp.Body))
	}
	if resp.Usage.TotalTokens == 0 {
		t.Fatalf("expected non-zero usage; body=%s", string(resp.Body))
	}
}

// TestBedrockVPCELive_PingStream is the streaming counterpart: it exercises
// dispatchBedrockVPCEStream (ConverseStream over the BaseEndpoint) and asserts
// the eventstream round-trips, accumulating non-empty text across chunks and a
// terminal finish reason. Same env gating as the non-streaming ping.
func TestBedrockVPCELive_PingStream(t *testing.T) {
	endpoint := os.Getenv("BVPCE_ENDPOINT")
	if endpoint == "" {
		t.Skip("BVPCE_ENDPOINT not set; skipping live Bedrock VPCE stream test")
	}
	ak := os.Getenv("AWS_ACCESS_KEY_ID")
	sk := os.Getenv("AWS_SECRET_ACCESS_KEY")
	if ak == "" || sk == "" {
		t.Skip("AWS creds not set; skipping live Bedrock VPCE stream test")
	}
	region := os.Getenv("BVPCE_REGION")
	if region == "" {
		region = "us-east-1"
	}
	model := os.Getenv("BVPCE_MODEL")
	if model == "" {
		t.Fatal("BVPCE_MODEL must be set (the inference-profile id to invoke)")
	}

	extra := map[string]string{
		"bedrock_runtime_endpoint": endpoint,
		"access_key":               ak,
		"secret_key":               sk,
		"region":                   region,
	}
	if st := os.Getenv("AWS_SESSION_TOKEN"); st != "" {
		extra["session_token"] = st
	}

	cred := domain.Credential{
		ID:         "live-bedrock-vpce-stream",
		ProviderID: domain.ProviderBedrock,
		Extra:      extra,
	}
	req := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body:  []byte(`{"messages":[{"role":"user","content":"count from one to five in words, space separated"}],"max_tokens":32}`),
	}

	// Bound the stream so a stalled upstream can't hang the test forever.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	router := &BifrostRouter{}
	iter, err := router.dispatchBedrockVPCEStream(ctx, req, mapProvider(cred.ProviderID), model, cred, endpoint)
	if err != nil {
		t.Fatalf("dispatchBedrockVPCEStream error: %v", err)
	}
	defer iter.Close()

	var chunks, deltas int
	var text, finish string
	for iter.Next(ctx) {
		chunks++
		chunk := iter.Chunk()
		if d := gjson.GetBytes(chunk, "choices.0.delta.content").String(); d != "" {
			deltas++
			text += d
		}
		if fr := gjson.GetBytes(chunk, "choices.0.finish_reason").String(); fr != "" {
			finish = fr
		}
	}
	if err := iter.Err(); err != nil {
		t.Fatalf("stream iterator error: %v", err)
	}

	t.Logf("LIVE STREAM 200 via %s | model=%s | chunks=%d deltas=%d | finish=%q | text=%q",
		endpoint, model, chunks, deltas, finish, text)

	if deltas == 0 || text == "" {
		t.Fatalf("expected non-empty streamed text; chunks=%d deltas=%d", chunks, deltas)
	}
	if finish == "" {
		t.Fatalf("expected a terminal finish reason; got none over %d chunks", chunks)
	}
}
