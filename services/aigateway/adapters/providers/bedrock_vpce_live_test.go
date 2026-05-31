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

// TestBedrockVPCELive_StructuredOutputToolChoice exercises the forced
// tool_use path that nlpgo's executor.go uses to translate
// response_format into structured outputs for bedrock+anthropic. Customer
// dogfood 2026-05-31: nlpgo's translation sent tools + tool_choice but
// the VPCE intercept's mapBedrockToolConfig dropped tool_choice, so the
// model was free to ignore the synthetic lw_so_* tool and replied with
// text. The engine's prose-fallback then dumped the entire reasoning
// into the first declared output field. Same prompt shape as the
// customer's failing classifier-relevance workflow (long system
// instructions, structured-output schema with bool + str outputs).
//
// Run against any VPCE-compatible endpoint:
//
//	AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//	BVPCE_ENDPOINT=https://bedrock-runtime.us-east-1.amazonaws.com \
//	BVPCE_REGION=us-east-1 \
//	BVPCE_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0 \
//	go test -tags live_bedrock_vpce ./services/aigateway/adapters/providers/ \
//	  -run BedrockVPCELive_StructuredOutputToolChoice -count=1 -v
func TestBedrockVPCELive_StructuredOutputToolChoice(t *testing.T) {
	endpoint := os.Getenv("BVPCE_ENDPOINT")
	if endpoint == "" {
		t.Skip("BVPCE_ENDPOINT not set; skipping live Bedrock VPCE structured-output test")
	}
	ak := os.Getenv("AWS_ACCESS_KEY_ID")
	sk := os.Getenv("AWS_SECRET_ACCESS_KEY")
	if ak == "" || sk == "" {
		t.Skip("AWS creds not set; skipping live Bedrock VPCE structured-output test")
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
		ID:         "live-bedrock-vpce-so",
		ProviderID: domain.ProviderBedrock,
		Extra:      extra,
	}
	// Mirrors what nlpgo executor.go emits for a signature node with
	// {output:bool, reason:str} outputs after translating response_format
	// to forced tool_use (shouldUseToolUseForStructuredOutput +
	// buildStructuredOutputTool). The synthetic tool name uses the
	// lw_so_<schema> prefix the engine uses.
	body := []byte(`{
		"messages":[
			{"role":"system","content":"You are a strict boolean evaluator. Return TRUE only when the user input describes a feature-comparison question."},
			{"role":"user","content":"What is the difference between budget navigator and pacing monitor?"}
		],
		"max_tokens":1024,
		"tools":[{
			"type":"function",
			"function":{
				"name":"lw_so_ClassifierRelevance",
				"description":"Return the response as a JSON object matching the declared output schema.",
				"parameters":{
					"type":"object",
					"properties":{
						"output":{"type":"boolean"},
						"reason":{"type":"string"}
					},
					"required":["output","reason"],
					"additionalProperties":false
				},
				"strict":true
			}
		}],
		"tool_choice":{"type":"function","function":{"name":"lw_so_ClassifierRelevance"}}
	}`)
	req := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body:  body,
	}

	router := &BifrostRouter{}
	resp, err := router.dispatchBedrockVPCE(context.Background(), req, mapProvider(cred.ProviderID), model, cred, endpoint)
	if err != nil {
		t.Fatalf("dispatchBedrockVPCE error: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d; body=%s", resp.StatusCode, string(resp.Body))
	}

	// Post-fix: the model MUST call the forced tool. The response shape
	// carries the structured payload on tool_calls[0].function.arguments
	// (JSON string), with empty text content. Pre-fix (tool_choice
	// silently dropped by mapBedrockToolConfig): the model returned text
	// content and no tool_calls — exact pre-fix manifestation that
	// triggered the engine's prose-fallback into the first declared
	// output field.
	toolName := gjson.GetBytes(resp.Body, "choices.0.message.tool_calls.0.function.name").String()
	args := gjson.GetBytes(resp.Body, "choices.0.message.tool_calls.0.function.arguments").String()
	textContent := gjson.GetBytes(resp.Body, "choices.0.message.content").String()
	t.Logf("LIVE 200 via %s | model=%s | tool_name=%q | args=%q | text=%q",
		endpoint, model, toolName, args, textContent)

	if toolName != "lw_so_ClassifierRelevance" {
		t.Fatalf("expected forced tool call to lw_so_ClassifierRelevance, got %q (text content: %q) — tool_choice was likely dropped on the VPCE intercept path",
			toolName, textContent)
	}
	if args == "" {
		t.Fatalf("expected non-empty tool_call arguments JSON; body=%s", string(resp.Body))
	}
	if !gjson.Valid(args) {
		t.Fatalf("tool_call arguments must be valid JSON, got %q", args)
	}
	output := gjson.Get(args, "output")
	if !output.Exists() {
		t.Fatalf("expected `output` field in tool_call arguments; got %s", args)
	}
	if output.Type != gjson.True && output.Type != gjson.False {
		t.Fatalf("expected `output` to be a real bool, got type=%v value=%v", output.Type, output.Value())
	}
	if reason := gjson.Get(args, "reason").String(); reason == "" {
		t.Fatalf("expected non-empty `reason` field in tool_call arguments; got %s", args)
	}
}
