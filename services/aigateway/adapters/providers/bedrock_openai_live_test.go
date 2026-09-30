//go:build live_bedrock_openai

// Live check that OpenAI models on Bedrock, reached through the global
// inference profiles, answer through the gateway's normal Dispatch path with
// plain bedrock:InvokeModel credentials. Gated behind the live_bedrock_openai
// build tag and env vars so it never runs in CI.
//
//	AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION_NAME=eu-central-1 \
//	BEDROCK_OPENAI_MODEL=global.openai.gpt-5.5 \
//	go test -tags live_bedrock_openai ./services/aigateway/adapters/providers/ \
//	  -run BedrockOpenAILive -count=1 -v
package providers

import (
	"context"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func liveBedrockOpenAICred(t *testing.T) (domain.Credential, string) {
	t.Helper()
	ak, sk := os.Getenv("AWS_ACCESS_KEY_ID"), os.Getenv("AWS_SECRET_ACCESS_KEY")
	if ak == "" || sk == "" {
		t.Skip("AWS creds not set")
	}
	region := os.Getenv("AWS_REGION_NAME")
	if region == "" {
		region = "eu-central-1"
	}
	model := os.Getenv("BEDROCK_OPENAI_MODEL")
	if model == "" {
		model = "global.openai.gpt-5.5"
	}
	return domain.Credential{
		ID:         "live-bedrock-openai",
		ProviderID: domain.ProviderBedrock,
		Extra:      map[string]string{"access_key": ak, "secret_key": sk, "region": region},
	}, model
}

func TestBedrockOpenAILive_Chat(t *testing.T) {
	cred, model := liveBedrockOpenAICred(t)
	router := newTestRouter(t)
	resp, err := router.Dispatch(context.Background(), &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body:  []byte(`{"messages":[{"role":"system","content":"be brief"},{"role":"user","content":"reply with the single word: pong"}],"max_tokens":64}`),
	}, cred)
	if err != nil {
		t.Fatalf("Dispatch error: %v", err)
	}
	text := gjson.GetBytes(resp.Body, "choices.0.message.content").String()
	t.Logf("status=%d text=%q", resp.StatusCode, text)
	if text == "" {
		t.Fatalf("empty answer; body=%s", resp.Body)
	}
}

func TestBedrockOpenAILive_ChatStreamWithTools(t *testing.T) {
	cred, model := liveBedrockOpenAICred(t)
	router := newTestRouter(t)
	it, err := router.DispatchStream(context.Background(), &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body: []byte(`{"stream":true,"messages":[{"role":"user","content":"What is the weather in Paris? Use the tool."}],
			"tools":[{"type":"function","function":{"name":"get_weather","description":"Weather for a city","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}]}`),
	}, cred)
	if err != nil {
		t.Fatalf("DispatchStream error: %v", err)
	}
	var sb strings.Builder
	for it.Next(context.Background()) {
		sb.Write(it.Chunk())
	}
	if err := it.Err(); err != nil && err != io.EOF {
		t.Fatalf("stream error: %v", err)
	}
	out := sb.String()
	t.Logf("stream: %s", out[:min(len(out), 1500)])
	if !strings.Contains(out, "get_weather") {
		t.Fatalf("expected a get_weather tool call in the stream")
	}
}

// The body shape Langy's pi harness sends on its chat-completions lane: a
// system prompt, a finished tool round trip in the history, store:false,
// stream_options and max_completion_tokens.
func TestBedrockOpenAILive_LangyShapedTurn(t *testing.T) {
	cred, model := liveBedrockOpenAICred(t)
	router := newTestRouter(t)
	it, err := router.DispatchStream(context.Background(), &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body: []byte(`{"stream":true,"store":false,"stream_options":{"include_usage":true},"max_completion_tokens":2048,
			"messages":[
				{"role":"system","content":"You are Langy. Be brief."},
				{"role":"user","content":"List the files, then tell me how many there are."},
				{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"ls","arguments":"{\"path\":\".\"}"}}]},
				{"role":"tool","tool_call_id":"call_1","content":"agent.py\nrequirements.txt\n.env"}
			],
			"tools":[{"type":"function","function":{"name":"ls","description":"List files","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]}`),
	}, cred)
	if err != nil {
		t.Fatalf("DispatchStream error: %v", err)
	}
	var sb strings.Builder
	for it.Next(context.Background()) {
		sb.Write(it.Chunk())
	}
	if err := it.Err(); err != nil && err != io.EOF {
		t.Fatalf("stream error: %v", err)
	}
	out := sb.String()
	t.Logf("stream tail: %s", out[max(0, len(out)-600):])
	if !strings.Contains(out, "3") && !strings.Contains(strings.ToLower(out), "three") {
		t.Fatalf("expected the answer to count three files")
	}
}
