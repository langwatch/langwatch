package providers

import (
	"context"
	"strings"
	"testing"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// docJSON marshals an AWS document.Interface back to JSON for assertions.
func docJSON(t *testing.T, d interface{ MarshalSmithyDocument() ([]byte, error) }) []byte {
	t.Helper()
	b, err := d.MarshalSmithyDocument()
	if err != nil {
		t.Fatalf("marshal document: %v", err)
	}
	return b
}

func vpceParams(t *testing.T, body string) *bfschemas.ChatParameters {
	t.Helper()
	_, params, err := parseOpenAIChatRequest([]byte(body))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return params
}

// @scenario "the managed Bedrock endpoint maps reasoning and json_schema like public bedrock"
// The VPCE mapper used to drop reasoning and response_format entirely
// while bifrost's public bedrock lane mapped them: the exact divergence
// the shared policy table exists to prevent. Wire shapes mirror bifrost's
// bedrock translator.
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestVPCE_MapsReasoningEffortToThinking(t *testing.T) {
	// Non-adaptive Claude: budget = 1024 + 0.15 x (2048 - 1024) = 1177.
	params := vpceParams(t, `{"model":"m","messages":[],"reasoning_effort":"low","max_tokens":2048}`)
	doc, err := mapBedrockAdditionalFields(context.Background(), params, "eu.anthropic.claude-haiku-4-5-20251001-v1:0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	j := docJSON(t, doc)
	if gjson.GetBytes(j, "thinking.type").String() != "enabled" {
		t.Fatalf("thinking = %s, want enabled", j)
	}
	if got := gjson.GetBytes(j, "thinking.budget_tokens").Int(); got != 1177 {
		t.Fatalf("budget_tokens = %d, want 1177 (1024 + 0.15 x 1024)", got)
	}
}

func TestVPCE_AdaptiveThinkingOnOpus47(t *testing.T) {
	params := vpceParams(t, `{"model":"m","messages":[],"reasoning_effort":"minimal"}`)
	doc, err := mapBedrockAdditionalFields(context.Background(), params, "eu.anthropic.claude-opus-4-7-v1:0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	j := docJSON(t, doc)
	if gjson.GetBytes(j, "thinking.type").String() != "adaptive" {
		t.Fatalf("thinking = %s, want adaptive on 4.7", j)
	}
	if gjson.GetBytes(j, "output_config.effort").String() != "low" {
		t.Fatalf("effort = %s, want minimal mapped to low", j)
	}
}

func TestVPCE_MapsJSONSchemaToOutputConfig(t *testing.T) {
	params := vpceParams(t, `{"model":"m","messages":[],"response_format":{"type":"json_schema","json_schema":{"name":"city","strict":true,"schema":{"type":"object","properties":{"city":{"type":"string"}}}}}}`)
	doc, err := mapBedrockAdditionalFields(context.Background(), params, "eu.anthropic.claude-haiku-4-5-20251001-v1:0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	j := docJSON(t, doc)
	if gjson.GetBytes(j, "output_config.format.type").String() != "json_schema" {
		t.Fatalf("format = %s, want json_schema under output_config", j)
	}
	if !gjson.GetBytes(j, "output_config.format.schema.properties.city").Exists() {
		t.Fatalf("schema not carried verbatim: %s", j)
	}
}

func TestVPCE_EffortAndSchemaCoexistUnderOutputConfig(t *testing.T) {
	params := vpceParams(t, `{"model":"m","messages":[],"reasoning_effort":"high","response_format":{"type":"json_schema","json_schema":{"name":"s","schema":{"type":"object"}}}}`)
	doc, err := mapBedrockAdditionalFields(context.Background(), params, "anthropic.claude-opus-4-6")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	j := docJSON(t, doc)
	if gjson.GetBytes(j, "output_config.effort").String() != "high" || !gjson.GetBytes(j, "output_config.format").Exists() {
		t.Fatalf("output_config must merge effort and format: %s", j)
	}
}

func TestVPCE_ThinkingBudgetFloor(t *testing.T) {
	params := vpceParams(t, `{"model":"m","messages":[],"reasoning_max_tokens":512}`)
	_, err := mapBedrockAdditionalFields(context.Background(), params, "anthropic.claude-haiku-4-5")
	if err == nil || !strings.Contains(err.Error(), "1024") {
		t.Fatalf("sub-floor budget accepted: %v", err)
	}
}

func TestVPCE_NoFeaturesMeansNilDocument(t *testing.T) {
	params := vpceParams(t, `{"model":"m","messages":[],"temperature":0.2}`)
	doc, err := mapBedrockAdditionalFields(context.Background(), params, "anthropic.claude-haiku-4-5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc != nil {
		b, _ := sonic.Marshal(doc)
		t.Fatalf("additional fields = %s, want nil when nothing is requested", b)
	}
}

// The caller's absent output cap must NOT be force-set: the budget is
// computed against the model default, but inferenceConfig stays as sent.
func TestVPCE_NoForcedOutputCap(t *testing.T) {
	params := vpceParams(t, `{"model":"m","messages":[],"reasoning_effort":"low"}`)
	doc, err := mapBedrockAdditionalFields(context.Background(), params, "anthropic.claude-haiku-4-5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc == nil {
		t.Fatal("thinking not mapped")
	}
	if params.MaxCompletionTokens != nil {
		t.Fatal("mapping must not write an output cap the caller never sent")
	}
	cfg := mapBedrockInferenceConfig(params)
	if cfg != nil && cfg.MaxTokens != nil {
		t.Fatal("inferenceConfig.maxTokens must stay absent")
	}
}

// @scenario "Structured output on an OpenAI model on Bedrock is enforced through Converse"
func TestConverse_MapsJSONSchemaToTextFormatForOpenAIModels(t *testing.T) {
	params := vpceParams(t, `{"model":"m","messages":[],"response_format":{"type":"json_schema","json_schema":{"name":"city","strict":true,"schema":{"type":"object","properties":{"city":{"type":"string"}}}}}}`)
	for _, model := range []string{"global.openai.gpt-5.5", "global.openai.gpt-6-luna"} {
		doc, err := mapBedrockAdditionalFields(context.Background(), params, model)
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", model, err)
		}
		j := docJSON(t, doc)
		if gjson.GetBytes(j, "text.format.type").String() != "json_schema" ||
			gjson.GetBytes(j, "text.format.name").String() != "city" ||
			!gjson.GetBytes(j, "text.format.strict").Bool() ||
			!gjson.GetBytes(j, "text.format.schema.properties.city").Exists() {
			t.Fatalf("%s: want the schema under text.format, got %s", model, j)
		}
		if gjson.GetBytes(j, "output_config").Exists() || gjson.GetBytes(j, "response_format").Exists() {
			t.Fatalf("%s: only text.format carries the schema, got %s", model, j)
		}
	}

	// gpt-oss answers text.format with free text around the JSON, so the
	// schema is refused rather than silently unenforced.
	if _, err := mapBedrockAdditionalFields(context.Background(), params, "openai.gpt-oss-120b-1:0"); err == nil {
		t.Fatal("gpt-oss: want the json_schema refused")
	}
}

// A deployment alias of an OpenAI model maps its json_schema like the model
// itself: the family check reads the resolved id the request routed on.
// @scenario "Structured output on an OpenAI model on Bedrock is enforced through Converse"
func TestConverse_JSONSchemaFollowsTheDeploymentMap(t *testing.T) {
	cred := domain.Credential{
		ProviderID:    domain.ProviderBedrock,
		Extra:         map[string]string{"region": "eu-central-1"},
		DeploymentMap: map[string]string{"helpdesk": "global.openai.gpt-5.5"},
	}
	req := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "helpdesk",
		Body:  []byte(`{"messages":[{"role":"user","content":"hi"}],"response_format":{"type":"json_schema","json_schema":{"name":"city","schema":{"type":"object"}}}}`),
	}
	router := &BifrostRouter{}
	input, _, err := router.buildConverseInput(context.Background(), req, mapProvider(cred), "helpdesk", cred)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := *input.ModelId; got != "global.openai.gpt-5.5" {
		t.Fatalf("model id = %q, want the mapped inference profile", got)
	}
	if j := docJSON(t, input.AdditionalModelRequestFields); gjson.GetBytes(j, "text.format.name").String() != "city" {
		t.Fatalf("want the schema under text.format, got %s", j)
	}
}
