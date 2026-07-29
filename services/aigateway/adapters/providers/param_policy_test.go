package providers

import (
	"context"
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func chatReq(body string) *domain.Request {
	return &domain.Request{Type: domain.RequestTypeChat, Body: []byte(body)}
}

// build runs buildChatRequest and returns the request, the dropped list
// recorded on the returned context, and the error.
func build(t *testing.T, provider bfschemas.ModelProvider, model, body string) (*bfschemas.BifrostChatRequest, []string, error) {
	t.Helper()
	bfReq, ctx, err := buildChatRequest(context.Background(), chatReq(body), provider, model)
	if err != nil {
		return nil, nil, err
	}
	return bfReq, paramsDroppedFrom(ctx), nil
}

// @scenario "tier-3 params are dropped with a signal by default"
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestParamPolicy_DroppableParamsPerLane(t *testing.T) {
	cases := []struct {
		lane     string
		provider bfschemas.ModelProvider
		param    string
		body     string
	}{
		{"anthropic", bfschemas.Anthropic, "seed", `{"model":"m","messages":[],"seed":42}`},
		{"anthropic", bfschemas.Anthropic, "logit_bias", `{"model":"m","messages":[],"logit_bias":{"1":-100}}`},
		{"anthropic", bfschemas.Anthropic, "presence_penalty", `{"model":"m","messages":[],"presence_penalty":0.5}`},
		{"anthropic", bfschemas.Anthropic, "user", `{"model":"m","messages":[],"user":"u1"}`},
		{"anthropic", bfschemas.Anthropic, "metadata", `{"model":"m","messages":[],"metadata":{"a":"b"}}`},
		{"anthropic", bfschemas.Anthropic, "store", `{"model":"m","messages":[],"store":true}`},
		{"anthropic", bfschemas.Anthropic, "prediction", `{"model":"m","messages":[],"prediction":{"type":"content","content":"x"}}`},
		{"anthropic", bfschemas.Anthropic, "verbosity", `{"model":"m","messages":[],"verbosity":"low"}`},
		{"anthropic", bfschemas.Anthropic, "web_search_options", `{"model":"m","messages":[],"web_search_options":{}}`},
		{"anthropic", bfschemas.Anthropic, "n", `{"model":"m","messages":[],"n":2}`},
		{"anthropic", bfschemas.Anthropic, "min_p", `{"model":"m","messages":[],"min_p":0.1}`},
		{"bedrock", bfschemas.Bedrock, "frequency_penalty", `{"model":"m","messages":[],"frequency_penalty":0.5}`},
		{"bedrock", bfschemas.Bedrock, "seed", `{"model":"m","messages":[],"seed":42}`},
		{"bedrock", bfschemas.Bedrock, "service_tier", `{"model":"m","messages":[],"service_tier":"auto"}`},
		{"gemini", bfschemas.Gemini, "logit_bias", `{"model":"m","messages":[],"logit_bias":{"1":-100}}`},
		{"gemini", bfschemas.Gemini, "seed", `{"model":"m","messages":[],"seed":42}`},
		{"vertex", bfschemas.Vertex, "seed", `{"model":"m","messages":[],"seed":42}`},
	}
	for _, tc := range cases {
		_, dropped, err := build(t, tc.provider, "m", tc.body)
		if err != nil {
			t.Fatalf("%s/%s: unexpected error: %v", tc.lane, tc.param, err)
		}
		found := false
		for _, d := range dropped {
			if d == tc.param {
				found = true
			}
		}
		if !found {
			t.Fatalf("%s/%s: dropped = %v, want the param recorded (never silent)", tc.lane, tc.param, dropped)
		}
	}
}

// @scenario "drop_tuning_params false refuses any unmappable param"
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestParamPolicy_StrictModeRefusesDroppable(t *testing.T) {
	_, _, err := build(t, bfschemas.Anthropic, "claude-haiku-4-5",
		`{"model":"m","messages":[],"seed":42,"drop_tuning_params":false}`)
	if err == nil {
		t.Fatal("strict mode accepted an unmappable param")
	}
	for _, want := range []string{"refusing to drop 'seed'", "anthropic/claude-haiku-4-5", "drop_tuning_params is false", "set drop_tuning_params to true"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("refusal %q missing %q", err.Error(), want)
		}
	}
}

// @scenario "contract params always refuse, drop_tuning_params cannot drop them"
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestParamPolicy_ContractParamsAlwaysRefuse(t *testing.T) {
	cases := []struct {
		name     string
		provider bfschemas.ModelProvider
		model    string
		body     string
		wantIn   string
	}{
		{"json_object anthropic", bfschemas.Anthropic, "claude-haiku-4-5",
			`{"model":"m","messages":[],"response_format":{"type":"json_object"},"drop_tuning_params":true}`,
			"parseable JSON"},
		{"json_object bedrock", bfschemas.Bedrock, "anthropic.claude-haiku",
			`{"model":"m","messages":[],"response_format":{"type":"json_object"}}`,
			"parseable JSON"},
		{"logprobs anthropic", bfschemas.Anthropic, "claude-haiku-4-5",
			`{"model":"m","messages":[],"logprobs":true}`,
			"log probabilities"},
		{"top_logprobs bedrock", bfschemas.Bedrock, "anthropic.claude-haiku",
			`{"model":"m","messages":[],"top_logprobs":3}`,
			"log probabilities"},
		{"legacy functions", bfschemas.Anthropic, "claude-haiku-4-5",
			`{"model":"m","messages":[],"functions":[{"name":"f"}]}`,
			"use tools"},
		{"legacy function_call", bfschemas.Gemini, "gemini-2.5-flash",
			`{"model":"m","messages":[],"function_call":"auto"}`,
			"use tool_choice"},
		{"allowed_tools", bfschemas.Anthropic, "claude-haiku-4-5",
			`{"model":"m","messages":[],"tool_choice":{"type":"allowed_tools","allowed_tools":{"mode":"auto","tools":[]}}}`,
			"allowed tool list"},
		{"bedrock reasoning non-anthropic", bfschemas.Bedrock, "amazon.titan-text-express-v1",
			`{"model":"m","messages":[],"reasoning_effort":"low"}`,
			"reasoning"},
	}
	for _, tc := range cases {
		_, _, err := build(t, tc.provider, tc.model, tc.body)
		if err == nil {
			t.Fatalf("%s: contract param accepted", tc.name)
		}
		if !strings.Contains(err.Error(), "refusing to drop") || !strings.Contains(err.Error(), "depends on it functionally") {
			t.Fatalf("%s: refusal copy off: %q", tc.name, err.Error())
		}
		if !strings.Contains(err.Error(), tc.wantIn) {
			t.Fatalf("%s: refusal %q missing %q", tc.name, err.Error(), tc.wantIn)
		}
	}
}

// Mapped params pass the policy untouched and record nothing.
func TestParamPolicy_MappedParamsPass(t *testing.T) {
	cases := []struct {
		name     string
		provider bfschemas.ModelProvider
		model    string
		body     string
	}{
		{"temperature+stop anthropic", bfschemas.Anthropic, "claude-haiku-4-5",
			`{"model":"m","messages":[],"temperature":0.2,"stop":["x"],"max_tokens":16}`},
		{"json_schema anthropic", bfschemas.Anthropic, "claude-haiku-4-5",
			`{"model":"m","messages":[],"response_format":{"type":"json_schema","json_schema":{"name":"s","schema":{"type":"object"}}}}`},
		{"json_object gemini", bfschemas.Gemini, "gemini-2.5-flash",
			`{"model":"m","messages":[],"response_format":{"type":"json_object"}}`},
		{"logprobs gemini", bfschemas.Gemini, "gemini-2.5-flash",
			`{"model":"m","messages":[],"logprobs":true,"top_logprobs":2}`},
		{"penalties gemini", bfschemas.Gemini, "gemini-2.5-flash",
			`{"model":"m","messages":[],"presence_penalty":0.1,"frequency_penalty":0.1}`},
		{"reasoning bedrock claude", bfschemas.Bedrock, "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
			`{"model":"m","messages":[],"reasoning_effort":"low","max_tokens":2048}`},
		{"reasoning bedrock nova", bfschemas.Bedrock, "amazon.nova-pro-v1:0",
			`{"model":"m","messages":[],"reasoning_effort":"low"}`},
		{"n=1", bfschemas.Anthropic, "claude-haiku-4-5",
			`{"model":"m","messages":[],"n":1}`},
		{"service_tier auto anthropic", bfschemas.Anthropic, "claude-haiku-4-5",
			`{"model":"m","messages":[],"service_tier":"auto"}`},
		{"named tool present", bfschemas.Bedrock, "anthropic.claude-haiku",
			`{"model":"m","messages":[],"tools":[{"type":"function","function":{"name":"f","parameters":{}}}],"tool_choice":{"type":"function","function":{"name":"f"}}}`},
	}
	for _, tc := range cases {
		_, dropped, err := build(t, tc.provider, tc.model, tc.body)
		if err != nil {
			t.Fatalf("%s: unexpected refusal: %v", tc.name, err)
		}
		if len(dropped) != 0 {
			t.Fatalf("%s: dropped = %v, want none", tc.name, dropped)
		}
	}
}

// @scenario "a named tool_choice must reference a tool in the request"
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestParamPolicy_NamedToolChoiceMustExist(t *testing.T) {
	_, _, err := build(t, bfschemas.Bedrock, "anthropic.claude-haiku",
		`{"model":"m","messages":[],"tools":[{"type":"function","function":{"name":"f","parameters":{}}}],"tool_choice":{"type":"function","function":{"name":"ghost"}}}`)
	if err == nil {
		t.Fatal("named tool_choice for a missing tool accepted; Bedrock would silently null it and 400 downstream")
	}
	if !strings.Contains(err.Error(), `"ghost"`) {
		t.Fatalf("refusal %q does not name the missing tool", err.Error())
	}
}

// Bedrock tool_choice "none": Converse has no none mode, so the faithful
// mapping removes the tools entirely. A model with no tools can call none.
func TestParamPolicy_BedrockToolChoiceNoneRemovesTools(t *testing.T) {
	bfReq, dropped, err := build(t, bfschemas.Bedrock, "anthropic.claude-haiku",
		`{"model":"m","messages":[],"tools":[{"type":"function","function":{"name":"f","parameters":{}}}],"tool_choice":"none"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(dropped) != 0 {
		t.Fatalf("dropped = %v, want none: this is a mapping, not a drop", dropped)
	}
	if bfReq.Params.Tools != nil || bfReq.Params.ToolChoice != nil {
		t.Fatal("tool_choice none on bedrock must remove tools and tool_choice; bifrost would otherwise default to auto")
	}
}

// Anthropic keeps its native none mode; tools stay.
func TestParamPolicy_AnthropicToolChoiceNoneKeepsTools(t *testing.T) {
	bfReq, _, err := build(t, bfschemas.Anthropic, "claude-haiku-4-5",
		`{"model":"m","messages":[],"tools":[{"type":"function","function":{"name":"f","parameters":{}}}],"tool_choice":"none"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if bfReq.Params.Tools == nil {
		t.Fatal("anthropic maps none natively; tools must not be removed")
	}
}

// @scenario "top_p with temperature is dropped visibly on Anthropic models"
// Anthropic models reject the pair with a hard 400 (verified live on the
// anthropic and bedrock lanes), so the faithful options are refuse or
// drop; top_p is a tuning knob, so it drops with a signal and temperature
// wins. Alone, top_p maps everywhere. Non-Anthropic bedrock families take
// both.
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestParamPolicy_TopPWithTemperature(t *testing.T) {
	bfReq, dropped, err := build(t, bfschemas.Anthropic, "claude-haiku-4-5",
		`{"model":"m","messages":[],"temperature":0.3,"top_p":0.9}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(dropped) != 1 || dropped[0] != "top_p" {
		t.Fatalf("dropped = %v, want [top_p]", dropped)
	}
	if bfReq.Params.TopP != nil {
		t.Fatal("TopP not cleared; the provider rejects the pair")
	}
	if bfReq.Params.Temperature == nil {
		t.Fatal("temperature must survive")
	}

	// Alone, top_p maps: no drop, field kept.
	bfReq2, dropped2, err := build(t, bfschemas.Anthropic, "claude-haiku-4-5",
		`{"model":"m","messages":[],"top_p":0.9}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(dropped2) != 0 || bfReq2.Params.TopP == nil {
		t.Fatalf("top_p alone must map (dropped=%v)", dropped2)
	}

	// Bedrock keeps both for non-Anthropic families.
	bfReq3, dropped3, err := build(t, bfschemas.Bedrock, "amazon.nova-pro-v1:0",
		`{"model":"m","messages":[],"temperature":0.3,"top_p":0.9}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(dropped3) != 0 || bfReq3.Params.TopP == nil {
		t.Fatalf("nova takes both (dropped=%v)", dropped3)
	}

	// Strict mode refuses the combination instead of dropping.
	_, _, err = build(t, bfschemas.Anthropic, "claude-haiku-4-5",
		`{"model":"m","messages":[],"temperature":0.3,"top_p":0.9,"drop_tuning_params":false}`)
	if err == nil {
		t.Fatal("strict mode must refuse the unmappable combination")
	}
}

// service_tier is cleared from the typed params when dropped, so the
// bedrock translator cannot forward it into AWS's different enum (which
// answers a hard 400 for OpenAI's values).
func TestParamPolicy_ServiceTierClearedOnDrop(t *testing.T) {
	bfReq, dropped, err := build(t, bfschemas.Bedrock, "anthropic.claude-haiku",
		`{"model":"m","messages":[],"service_tier":"auto"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(dropped) != 1 || dropped[0] != "service_tier" {
		t.Fatalf("dropped = %v, want [service_tier]", dropped)
	}
	if bfReq.Params.ServiceTier != nil {
		t.Fatal("ServiceTier not cleared; the translator would forward it and AWS 400s")
	}
}

// stop as a bare string (valid OpenAI) is normalized, not rejected.
func TestParamPolicy_StopStringNormalized(t *testing.T) {
	bfReq, dropped, err := build(t, bfschemas.Anthropic, "claude-haiku-4-5",
		`{"model":"m","messages":[],"stop":"END"}`)
	if err != nil {
		t.Fatalf("bare-string stop rejected: %v", err)
	}
	if len(dropped) != 0 {
		t.Fatalf("dropped = %v, want none", dropped)
	}
	if len(bfReq.Params.Stop) != 1 || bfReq.Params.Stop[0] != "END" {
		t.Fatalf("Stop = %v, want [END]", bfReq.Params.Stop)
	}
}

// Raw-forward lanes bypass the policy entirely: strict mode plus an
// unmappable param must not refuse, and the body stays byte-identical
// except for stripping the gateway-only drop_tuning_params field.
func TestParamPolicy_RawForwardBypassesPolicy(t *testing.T) {
	withFlag := `{"model":"gpt-5-mini","messages":[],"seed":42,"drop_tuning_params":false}`
	bfReq, _, err := buildChatRequest(context.Background(), chatReq(withFlag), bfschemas.OpenAI, "gpt-5-mini")
	if err != nil {
		t.Fatalf("raw lane consulted the policy: %v", err)
	}
	if gjson.GetBytes(bfReq.RawRequestBody, "drop_tuning_params").Exists() {
		t.Fatal("drop_tuning_params must be stripped before the provider sees the body")
	}
	if !gjson.GetBytes(bfReq.RawRequestBody, "seed").Exists() {
		t.Fatal("raw-forward must keep every provider param")
	}

	plain := `{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}],"seed":42}`
	bfReq2, _, err := buildChatRequest(context.Background(), chatReq(plain), bfschemas.OpenAI, "gpt-5-mini")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(bfReq2.RawRequestBody) != plain {
		t.Fatal("raw-forward body must stay byte-identical when drop_tuning_params is absent")
	}
}

// drop_tuning_params itself never reaches a translated provider either: the
// translated lanes rebuild the request from typed params, and drop_tuning_params
// is not one of them, so nothing to assert beyond the policy reading it.
func TestParamPolicy_DropTuningParamsDefaultTrue(t *testing.T) {
	if !dropTuningParamsEnabled([]byte(`{"model":"m"}`)) {
		t.Fatal("drop_tuning_params must default to true")
	}
	if dropTuningParamsEnabled([]byte(`{"model":"m","drop_tuning_params":false}`)) {
		t.Fatal("explicit false must disable dropping")
	}
	if !dropTuningParamsEnabled([]byte(`{"model":"m","drop_tuning_params":true}`)) {
		t.Fatal("explicit true keeps dropping enabled")
	}
}

// classifyChatBuildError: policy refusals carry unsupported_parameter,
// everything else stays bad_request.
func TestClassifyChatBuildError(t *testing.T) {
	refusal := classifyChatBuildError(context.Background(), &paramRefusalError{msg: "refusing to drop 'x'"})
	if !strings.Contains(refusal.Error(), "unsupported_parameter") {
		t.Fatalf("refusal classified as %v, want unsupported_parameter", refusal)
	}
	other := classifyChatBuildError(context.Background(), context.DeadlineExceeded)
	if !strings.Contains(other.Error(), "bad_request") {
		t.Fatalf("non-refusal classified as %v, want bad_request", other)
	}
}

// @scenario "a thinking-exhausted cap yields finish_reason length, not an empty 200"
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestEnsureChoicesPresent(t *testing.T) {
	repaired := ensureChoicesPresent([]byte(`{"id":"x","choices":null,"usage":{"completion_tokens":12}}`))
	if gjson.GetBytes(repaired, "choices.0.finish_reason").String() != "length" {
		t.Fatalf("null choices not repaired: %s", repaired)
	}
	if gjson.GetBytes(repaired, "choices.0.message.role").String() != "assistant" {
		t.Fatalf("synthesized choice malformed: %s", repaired)
	}
	if gjson.GetBytes(repaired, "usage.completion_tokens").Int() != 12 {
		t.Fatalf("usage must stay intact: %s", repaired)
	}

	empty := ensureChoicesPresent([]byte(`{"id":"x","choices":[]}`))
	if gjson.GetBytes(empty, "choices.#").Int() != 1 {
		t.Fatalf("empty choices not repaired: %s", empty)
	}

	untouched := `{"id":"x","choices":[{"index":0,"finish_reason":"stop"}]}`
	if string(ensureChoicesPresent([]byte(untouched))) != untouched {
		t.Fatal("populated choices must pass through untouched")
	}
}

func TestInjectParamsDropped(t *testing.T) {
	out := injectParamsDropped([]byte(`{"id":"x","extra_fields":{"provider":"anthropic"}}`), []string{"seed", "user"})
	if got := gjson.GetBytes(out, "extra_fields.params_dropped").Raw; got != `["seed","user"]` {
		t.Fatalf("params_dropped = %s", got)
	}
	if gjson.GetBytes(out, "extra_fields.provider").String() != "anthropic" {
		t.Fatal("sibling extra_fields keys must survive")
	}
	plain := `{"id":"x"}`
	if string(injectParamsDropped([]byte(plain), nil)) != plain {
		t.Fatal("no drops must mean no mutation")
	}
}
