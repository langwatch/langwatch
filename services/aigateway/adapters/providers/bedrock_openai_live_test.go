//go:build live_bedrock_openai

// Live check that OpenAI models on Bedrock, reached through the global
// inference profiles, answer through the gateway's normal Dispatch path with
// plain bedrock:InvokeModel credentials. Gated behind the live_bedrock_openai
// build tag and env vars so it never runs in CI.
//
//	AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION_NAME=eu-central-1 \
//	BEDROCK_OPENAI_MODEL=global.openai.gpt-5.5 \
//	BEDROCK_RUNTIME_ENDPOINT=https://bedrock-runtime.eu-central-1.amazonaws.com \
//	go test -tags live_bedrock_openai ./services/aigateway/adapters/providers/ \
//	  -run BedrockOpenAILive -count=1 -v
package providers

import (
	"context"
	"errors"
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
	extra := map[string]string{"access_key": ak, "secret_key": sk, "region": region}
	// A runtime endpoint sends any model, Claude included, through the
	// Converse lane, the way a managed VPC endpoint credential does.
	if endpoint := os.Getenv("BEDROCK_RUNTIME_ENDPOINT"); endpoint != "" {
		extra["bedrock_runtime_endpoint"] = endpoint
	}
	return domain.Credential{
		ID:         "live-bedrock-openai",
		ProviderID: domain.ProviderBedrock,
		Extra:      extra,
	}, model
}

// TestBedrockOpenAILive_Chat checks a plain chat answer through Dispatch.
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

// TestBedrockOpenAILive_ChatStreamWithTools checks a streamed tool call.
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

// TestBedrockOpenAILive_LangyShapedTurn sends what Langy's pi harness sends on
// its chat-completions lane: a system prompt, a finished tool round trip in
// the history, store:false, stream_options and max_completion_tokens.
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
		sb.WriteString(gjson.GetBytes(it.Chunk(), "choices.0.delta.content").String())
	}
	if err := it.Err(); err != nil && err != io.EOF {
		t.Fatalf("stream error: %v", err)
	}
	out := sb.String()
	t.Logf("answer: %q", out)
	if !strings.Contains(out, "3") && !strings.Contains(strings.ToLower(out), "three") {
		t.Fatalf("expected the answer to count three files")
	}
}

// TestBedrockOpenAILive_JSONSchema checks that a json_schema is enforced.
func TestBedrockOpenAILive_JSONSchema(t *testing.T) {
	cred, model := liveBedrockOpenAICred(t)
	router := newTestRouter(t)
	resp, err := router.Dispatch(context.Background(), &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body: []byte(`{"messages":[{"role":"user","content":"Capital of France? Answer as JSON."}],
			"response_format":{"type":"json_schema","json_schema":{"name":"answer","strict":true,"schema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"],"additionalProperties":false}}}}`),
	}, cred)
	if err != nil {
		t.Fatalf("Dispatch error: %v", err)
	}
	text := gjson.GetBytes(resp.Body, "choices.0.message.content").String()
	t.Logf("status=%d text=%q", resp.StatusCode, text)
	if gjson.Get(text, "city").String() == "" {
		t.Fatalf("want the answer under the schema's city key; body=%s", resp.Body)
	}
}

// TestBedrockOpenAILive_JSONSchemaStream checks that a streamed json_schema is enforced.
func TestBedrockOpenAILive_JSONSchemaStream(t *testing.T) {
	cred, model := liveBedrockOpenAICred(t)
	router := newTestRouter(t)
	it, err := router.DispatchStream(context.Background(), &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body: []byte(`{"stream":true,"messages":[{"role":"user","content":"Capital of France? Answer as JSON."}],
			"response_format":{"type":"json_schema","json_schema":{"name":"answer","strict":true,"schema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"],"additionalProperties":false}}}}`),
	}, cred)
	if err != nil {
		t.Fatalf("DispatchStream error: %v", err)
	}
	var sb strings.Builder
	for it.Next(context.Background()) {
		sb.WriteString(gjson.GetBytes(it.Chunk(), "choices.0.delta.content").String())
	}
	if err := it.Err(); err != nil && err != io.EOF {
		t.Fatalf("stream error: %v", err)
	}
	t.Logf("streamed text=%q", sb.String())
	if gjson.Get(sb.String(), "city").String() == "" {
		t.Fatalf("want the streamed answer under the schema's city key")
	}
}

// TestBedrockOpenAILive_ParallelToolResults sends a finished turn with two
// parallel tool calls, the shape Converse refused while each tool result
// travelled as its own user message ("Expected toolResult blocks at
// messages.2.content"), both streamed and not, and once with user text right
// after the results.
func TestBedrockOpenAILive_ParallelToolResults(t *testing.T) {
	cred, model := liveBedrockOpenAICred(t)
	router := newTestRouter(t)
	const history = `{"role":"system","content":"You help."},
		{"role":"user","content":"What is in the folder?"},
		{"role":"assistant","content":"","tool_calls":[
			{"id":"call_a1","type":"function","function":{"name":"list_dir","arguments":"{\"path\":\".\"}"}},
			{"id":"call_b2","type":"function","function":{"name":"list_dir","arguments":"{\"path\":\"src\"}"}}]},
		{"role":"tool","tool_call_id":"call_a1","content":"agent.py\nREADME.md"},
		{"role":"tool","tool_call_id":"call_b2","content":"not found"}`
	const tools = `"tools":[{"type":"function","function":{"name":"list_dir","description":"List a folder","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}]`

	t.Run("non-streaming", func(t *testing.T) {
		resp, err := router.Dispatch(context.Background(), &domain.Request{
			Type:  domain.RequestTypeChat,
			Model: model,
			Body:  []byte(`{"messages":[` + history + `],` + tools + `}`),
		}, cred)
		if err != nil {
			t.Fatalf("Dispatch error: %v", err)
		}
		text := gjson.GetBytes(resp.Body, "choices.0.message.content").String()
		t.Logf("status=%d text=%q", resp.StatusCode, text)
		if resp.StatusCode != 200 || text == "" {
			t.Fatalf("want an answer; body=%s", resp.Body)
		}
	})

	t.Run("streaming, with user text after the results", func(t *testing.T) {
		it, err := router.DispatchStream(context.Background(), &domain.Request{
			Type:  domain.RequestTypeChat,
			Model: model,
			Body: []byte(`{"stream":true,"messages":[` + history + `,
				{"role":"user","content":"Answer in one sentence."}],` + tools + `}`),
		}, cred)
		if err != nil {
			t.Fatalf("DispatchStream error: %v", err)
		}
		var sb strings.Builder
		for it.Next(context.Background()) {
			sb.WriteString(gjson.GetBytes(it.Chunk(), "choices.0.delta.content").String())
		}
		if err := it.Err(); err != nil && err != io.EOF {
			t.Fatalf("stream error: %v", err)
		}
		t.Logf("answer: %q", sb.String())
		if sb.String() == "" {
			t.Fatalf("want a streamed answer")
		}
	})
}

// TestBedrockOpenAILive_ConversationShapes sends the message orders the
// Converse mapping merges: a system message mid-conversation, an empty
// assistant message between two user messages, and a tool result with no
// content.
func TestBedrockOpenAILive_ConversationShapes(t *testing.T) {
	cred, model := liveBedrockOpenAICred(t)
	router := newTestRouter(t)
	cases := map[string]string{
		"system message mid-conversation": `[{"role":"user","content":"Hi."},
			{"role":"system","content":"Answer in one word."},
			{"role":"user","content":"Say hello."}]`,
		"empty assistant between user messages": `[{"role":"user","content":"Hi."},
			{"role":"assistant","content":""},
			{"role":"user","content":"Say hello in one word."}]`,
		"tool result with no content": `[{"role":"user","content":"Run it."},
			{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"run","arguments":"{}"}}]},
			{"role":"tool","tool_call_id":"call_1","content":""}]`,
	}
	const tools = `"tools":[{"type":"function","function":{"name":"run","description":"Run the job","parameters":{"type":"object","properties":{}}}}]`
	for name, messages := range cases {
		t.Run(name, func(t *testing.T) {
			resp, err := router.Dispatch(context.Background(), &domain.Request{
				Type:  domain.RequestTypeChat,
				Model: model,
				Body:  []byte(`{"messages":` + messages + `,` + tools + `}`),
			}, cred)
			if err != nil {
				t.Fatalf("Dispatch error: %v", err)
			}
			t.Logf("status=%d body=%s", resp.StatusCode, resp.Body[:min(len(resp.Body), 400)])
			if resp.StatusCode != 200 {
				t.Fatalf("want 200")
			}
		})
	}
}

// TestBedrockOpenAILive_RefusalKeepsStatus sends a tool result answering a
// call the assistant never made, which Bedrock refuses with a 400
// ValidationException, and checks the gateway forwards that 400 under the
// exception name instead of a retryable 502.
func TestBedrockOpenAILive_RefusalKeepsStatus(t *testing.T) {
	cred, model := liveBedrockOpenAICred(t)
	router := newTestRouter(t)
	_, err := router.Dispatch(context.Background(), &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: model,
		Body: []byte(`{"messages":[{"role":"user","content":"Run it."},
			{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"run","arguments":"{}"}}]},
			{"role":"tool","tool_call_id":"call_other","content":"done"}],
			"tools":[{"type":"function","function":{"name":"run","description":"Run the job","parameters":{"type":"object","properties":{}}}}]}`),
	}, cred)
	var ue *domain.UpstreamError
	if !errors.As(err, &ue) {
		t.Fatalf("want an UpstreamError, got %T: %v", err, err)
	}
	t.Logf("status=%d type=%q message=%q", ue.StatusCode, ue.ErrorType, ue.Message)
	if ue.StatusCode != 400 || ue.ErrorType != "ValidationException" {
		t.Fatalf("want 400 ValidationException")
	}
}
