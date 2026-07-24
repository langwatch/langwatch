package providers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	brtypes "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// given a managed-Bedrock credential carrying a runtime VPC endpoint
// when a chat request is dispatched through dispatchBedrockVPCE
// then the outbound request hits that endpoint (proving the BaseEndpoint
// override) and the response is an OpenAI-shaped completion with the canned
// text the test server returned.
/** @scenario "Chat request reaches and is signed for the customer endpoint" */
func TestBedrockVPCE_DispatchHitsEndpointAndShapesResponse(t *testing.T) {
	const cannedText = "the answer is 42"

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
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"output": {"message": {"role": "assistant", "content": [{"text": "` + cannedText + `"}]}},
			"stopReason": "end_turn",
			"usage": {"inputTokens": 11, "outputTokens": 7, "totalTokens": 18}
		}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	cred := domain.Credential{
		ID:         "cred-1",
		ProviderID: domain.ProviderBedrock,
		Extra: map[string]string{
			"bedrock_runtime_endpoint": srv.URL,
			"access_key":               "AKIAEXAMPLE",
			"secret_key":               "secretexample",
			"region":                   "us-east-1",
		},
	}
	req := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
		Body:  []byte(`{"messages":[{"role":"user","content":"what is the answer?"}]}`),
	}

	provider := mapProvider(cred)
	endpoint := bedrockRuntimeEndpoint(cred)
	if endpoint == "" {
		t.Fatal("bedrockRuntimeEndpoint returned empty for a cred carrying the endpoint")
	}

	resp, err := router.dispatchBedrockVPCE(context.Background(), req, provider, req.Model, cred, endpoint)
	if err != nil {
		t.Fatalf("dispatchBedrockVPCE returned error: %v", err)
	}

	if !captured.hit {
		t.Fatal("test server was never hit — BaseEndpoint override did not take effect")
	}
	if !strings.Contains(srv.URL, captured.host) {
		t.Fatalf("outbound Host %q does not match the VPC endpoint %q", captured.host, srv.URL)
	}
	if !strings.Contains(captured.path, "converse") {
		t.Fatalf("expected Converse path, got %q", captured.path)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	gotText := gjson.GetBytes(resp.Body, "choices.0.message.content").String()
	if gotText != cannedText {
		t.Fatalf("response content mismatch: got %q, want %q", gotText, cannedText)
	}
	if obj := gjson.GetBytes(resp.Body, "object").String(); obj != "chat.completion" {
		t.Fatalf("expected object=chat.completion, got %q", obj)
	}
	if fr := gjson.GetBytes(resp.Body, "choices.0.finish_reason").String(); fr != "stop" {
		t.Fatalf("expected finish_reason=stop, got %q", fr)
	}
	if role := gjson.GetBytes(resp.Body, "choices.0.message.role").String(); role != "assistant" {
		t.Fatalf("expected role=assistant, got %q", role)
	}

	if resp.Usage.PromptTokens != 11 || resp.Usage.CompletionTokens != 7 || resp.Usage.TotalTokens != 18 {
		t.Fatalf("usage mismatch: %+v", resp.Usage)
	}
}

// given a Bedrock credential without any runtime endpoint key
// when bedrockRuntimeEndpoint is read
// then it returns empty so dispatch stays on the bifrost path.
/** @scenario "A Bedrock credential without a runtime endpoint stays on the default path" */
func TestBedrockRuntimeEndpoint_AbsentReturnsEmpty(t *testing.T) {
	if got := bedrockRuntimeEndpoint(domain.Credential{}); got != "" {
		t.Fatalf("nil Extra should yield empty endpoint, got %q", got)
	}
	cred := domain.Credential{Extra: map[string]string{"region": "us-east-1"}}
	if got := bedrockRuntimeEndpoint(cred); got != "" {
		t.Fatalf("missing endpoint key should yield empty, got %q", got)
	}
}

// given the fallback endpoint key (aws_bedrock_runtime_endpoint)
// when bedrockRuntimeEndpoint is read
// then it returns the fallback value (the two nlpgo paths name it differently).
func TestBedrockRuntimeEndpoint_FallbackKey(t *testing.T) {
	cred := domain.Credential{Extra: map[string]string{
		"aws_bedrock_runtime_endpoint": "https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
	}}
	got := bedrockRuntimeEndpoint(cred)
	if got != "https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com" {
		t.Fatalf("fallback key not honored, got %q", got)
	}
}

// given various runtime endpoint strings
// when validateBedrockEndpoint inspects them
// then only http/https URLs whose host is within the AWS-controlled
// amazonaws.com domain are accepted, closing the SSRF surface while still
// allowing both the public endpoint and PrivateLink VPC endpoints (incl. the
// customer's plain-http :80 VPCE).
func TestValidateBedrockEndpoint(t *testing.T) {
	valid := []string{
		"https://bedrock-runtime.us-east-1.amazonaws.com",
		"http://vpce-0b96b0d0dd1bc0391-yyy7ck36.vpce-svc-02cf455d913d12412.us-east-1.vpce.amazonaws.com:80",
		"https://vpce-0b96b0d0dd1bc0391-yyy7ck36.vpce-svc-02cf455d913d12412.us-east-1.vpce.amazonaws.com", // https VPCE also fine
		"https://bedrock-runtime-fips.us-west-2.amazonaws.com",
	}
	for _, e := range valid {
		if err := validateBedrockEndpoint(e); err != nil {
			t.Errorf("expected %q to be valid, got %v", e, err)
		}
	}

	invalid := []string{
		"", // empty
		"http://169.254.169.254/latest/meta-data",        // instance metadata
		"http://127.0.0.1:8080",                          // loopback
		"https://internal-service.local",                 // internal host
		"https://evil.com",                               // arbitrary external
		"https://bedrock-runtime.amazonaws.com.evil.com", // suffix-spoof
		"ftp://bedrock-runtime.us-east-1.amazonaws.com",  // bad scheme
		"bedrock-runtime.us-east-1.amazonaws.com",        // no scheme/host
		"http://bedrock-runtime.us-east-1.amazonaws.com", // plaintext public bedrock (must be https; http only for .vpce hosts)
	}
	for _, e := range invalid {
		if err := validateBedrockEndpoint(e); err == nil {
			t.Errorf("expected %q to be rejected, got nil error", e)
		}
	}
}

// given credentials at the managed-Bedrock admission gate
// when bedrockVPCEEndpoint evaluates them
// then it returns the endpoint for a valid bedrock cred, "" to stay on bifrost
// for a non-bedrock or endpoint-less cred, and an error (fail closed) when an
// endpoint is present but untrusted.
func TestBedrockVPCEEndpoint_Gate(t *testing.T) {
	// non-bedrock provider → stay on bifrost
	if ep, err := bedrockVPCEEndpoint(domain.Credential{ProviderID: domain.ProviderOpenAI, Extra: map[string]string{"bedrock_runtime_endpoint": "https://bedrock-runtime.us-east-1.amazonaws.com"}}); ep != "" || err != nil {
		t.Errorf("non-bedrock cred: got (%q, %v), want (\"\", nil)", ep, err)
	}
	// bedrock without endpoint → stay on bifrost
	if ep, err := bedrockVPCEEndpoint(domain.Credential{ProviderID: domain.ProviderBedrock}); ep != "" || err != nil {
		t.Errorf("endpoint-less bedrock cred: got (%q, %v), want (\"\", nil)", ep, err)
	}
	// bedrock with valid endpoint → dispatch through it
	good := "http://vpce-abc.vpce-svc.us-east-1.vpce.amazonaws.com:80"
	if ep, err := bedrockVPCEEndpoint(domain.Credential{ProviderID: domain.ProviderBedrock, Extra: map[string]string{"bedrock_runtime_endpoint": good}}); ep != good || err != nil {
		t.Errorf("valid bedrock cred: got (%q, %v), want (%q, nil)", ep, err, good)
	}
	// bedrock with untrusted endpoint → fail closed
	if ep, err := bedrockVPCEEndpoint(domain.Credential{ProviderID: domain.ProviderBedrock, Extra: map[string]string{"bedrock_runtime_endpoint": "http://169.254.169.254"}}); err == nil || ep != "" {
		t.Errorf("untrusted endpoint: got (%q, %v), want (\"\", error)", ep, err)
	}
}

// given a credential carrying the litellm aws_* key names (the shape the
// gatewayproxy /go/proxy route produces, as opposed to the canonical names
// the dispatcheradapter produces)
// when a chat request is dispatched through dispatchBedrockVPCE
// then the request still reaches the endpoint, proving the credential reader
// honors both key conventions so the VPCE path works on either nlpgo route.
func TestBedrockVPCE_DispatchHonorsAWSStyleCredentialKeys(t *testing.T) {
	var hit bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hit = true
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"output": {"message": {"role": "assistant", "content": [{"text": "ok"}]}},
			"stopReason": "end_turn",
			"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}
		}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	cred := domain.Credential{
		ID:         "cred-aws",
		ProviderID: domain.ProviderBedrock,
		Extra: map[string]string{
			"aws_bedrock_runtime_endpoint": srv.URL,
			"aws_access_key_id":            "AKIAEXAMPLE",
			"aws_secret_access_key":        "secretexample",
			"aws_region_name":              "us-east-1",
		},
	}
	req := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
		Body:  []byte(`{"messages":[{"role":"user","content":"hi"}]}`),
	}

	endpoint := bedrockRuntimeEndpoint(cred)
	if endpoint == "" {
		t.Fatal("bedrockRuntimeEndpoint returned empty for the aws_* fallback key")
	}
	resp, err := router.dispatchBedrockVPCE(context.Background(), req, mapProvider(cred), req.Model, cred, endpoint)
	if err != nil {
		t.Fatalf("dispatchBedrockVPCE returned error: %v", err)
	}
	if !hit {
		t.Fatal("endpoint never hit — aws_* credential keys were not honored")
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
}

// TestMapBedrockToolChoice pins the OpenAI/bifrost tool_choice -> Bedrock
// Converse ToolChoice mapping. Pre-fix this branch did not exist and the
// VPCE intercept silently dropped tool_choice from the outbound request.
// Customer dogfood 2026-05-31: nlpgo's executor.go translates
// response_format -> tools + forced tool_choice for bedrock+anthropic
// structured outputs; without this mapper the model was free to ignore
// the synthetic lw_so_* tool and replied with text, which the engine's
// prose-fallback then dumped into the first declared output field.
func TestMapBedrockToolChoice(t *testing.T) {
	t.Run("nil input returns nil", func(t *testing.T) {
		if got := mapBedrockToolChoice(nil); got != nil {
			t.Fatalf("expected nil, got %#v", got)
		}
	})

	t.Run("string form: any => ToolChoiceMemberAny", func(t *testing.T) {
		s := "any"
		got := mapBedrockToolChoice(&bfschemas.ChatToolChoice{ChatToolChoiceStr: &s})
		if _, ok := got.(*brtypes.ToolChoiceMemberAny); !ok {
			t.Fatalf("expected ToolChoiceMemberAny, got %T", got)
		}
	})

	t.Run("string form: required => ToolChoiceMemberAny", func(t *testing.T) {
		s := "required"
		got := mapBedrockToolChoice(&bfschemas.ChatToolChoice{ChatToolChoiceStr: &s})
		if _, ok := got.(*brtypes.ToolChoiceMemberAny); !ok {
			t.Fatalf("expected ToolChoiceMemberAny, got %T", got)
		}
	})

	t.Run("string form: auto => ToolChoiceMemberAuto", func(t *testing.T) {
		s := "auto"
		got := mapBedrockToolChoice(&bfschemas.ChatToolChoice{ChatToolChoiceStr: &s})
		if _, ok := got.(*brtypes.ToolChoiceMemberAuto); !ok {
			t.Fatalf("expected ToolChoiceMemberAuto, got %T", got)
		}
	})

	t.Run("string form: none => nil (omit tools instead)", func(t *testing.T) {
		s := "none"
		if got := mapBedrockToolChoice(&bfschemas.ChatToolChoice{ChatToolChoiceStr: &s}); got != nil {
			t.Fatalf("expected nil for 'none', got %#v", got)
		}
	})

	t.Run("struct form: function with name => ToolChoiceMemberTool (the customer-fix case)", func(t *testing.T) {
		got := mapBedrockToolChoice(&bfschemas.ChatToolChoice{
			ChatToolChoiceStruct: &bfschemas.ChatToolChoiceStruct{
				Type:     bfschemas.ChatToolChoiceTypeFunction,
				Function: &bfschemas.ChatToolChoiceFunction{Name: "lw_so_ClassifierRelevance"},
			},
		})
		tool, ok := got.(*brtypes.ToolChoiceMemberTool)
		if !ok {
			t.Fatalf("expected ToolChoiceMemberTool, got %T — without this branch the forced-tool pin is silently dropped on the VPCE intercept path", got)
		}
		if tool.Value.Name == nil || *tool.Value.Name != "lw_so_ClassifierRelevance" {
			t.Fatalf("expected tool name lw_so_ClassifierRelevance, got %v", tool.Value.Name)
		}
	})

	t.Run("struct form: function with empty name => nil", func(t *testing.T) {
		got := mapBedrockToolChoice(&bfschemas.ChatToolChoice{
			ChatToolChoiceStruct: &bfschemas.ChatToolChoiceStruct{
				Type:     bfschemas.ChatToolChoiceTypeFunction,
				Function: &bfschemas.ChatToolChoiceFunction{Name: ""},
			},
		})
		if got != nil {
			t.Fatalf("expected nil for empty function name, got %#v", got)
		}
	})

	t.Run("struct form: any => ToolChoiceMemberAny", func(t *testing.T) {
		got := mapBedrockToolChoice(&bfschemas.ChatToolChoice{
			ChatToolChoiceStruct: &bfschemas.ChatToolChoiceStruct{Type: bfschemas.ChatToolChoiceTypeAny},
		})
		if _, ok := got.(*brtypes.ToolChoiceMemberAny); !ok {
			t.Fatalf("expected ToolChoiceMemberAny, got %T", got)
		}
	})

	t.Run("struct form: auto => ToolChoiceMemberAuto", func(t *testing.T) {
		got := mapBedrockToolChoice(&bfschemas.ChatToolChoice{
			ChatToolChoiceStruct: &bfschemas.ChatToolChoiceStruct{Type: bfschemas.ChatToolChoiceTypeAuto},
		})
		if _, ok := got.(*brtypes.ToolChoiceMemberAuto); !ok {
			t.Fatalf("expected ToolChoiceMemberAuto, got %T", got)
		}
	})
}

// TestMapBedrockToolConfig_ForwardsForcedToolChoice pins the end-to-end
// behavior at the public mapper boundary: when a request comes in with
// tools + a forced tool_choice (the shape nlpgo's executor.go emits for
// bedrock+anthropic structured outputs), the ToolConfiguration must
// include BOTH the tools array AND the ToolChoice pin.
func TestMapBedrockToolConfig_ForwardsForcedToolChoice(t *testing.T) {
	params := &bfschemas.ChatParameters{
		Tools: []bfschemas.ChatTool{
			{
				Function: &bfschemas.ChatToolFunction{
					Name:        "lw_so_ClassifierRelevance",
					Description: strPtr("Return the response as a JSON object matching the declared output schema."),
				},
			},
		},
		ToolChoice: &bfschemas.ChatToolChoice{
			ChatToolChoiceStruct: &bfschemas.ChatToolChoiceStruct{
				Type:     bfschemas.ChatToolChoiceTypeFunction,
				Function: &bfschemas.ChatToolChoiceFunction{Name: "lw_so_ClassifierRelevance"},
			},
		},
	}
	cfg := mapBedrockToolConfig(params)
	if cfg == nil {
		t.Fatal("expected non-nil ToolConfiguration")
	}
	if len(cfg.Tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(cfg.Tools))
	}
	tool, ok := cfg.ToolChoice.(*brtypes.ToolChoiceMemberTool)
	if !ok {
		t.Fatalf("expected forced tool choice, got %T — pre-fix this was nil and the VPCE intercept dropped the pin", cfg.ToolChoice)
	}
	if tool.Value.Name == nil || *tool.Value.Name != "lw_so_ClassifierRelevance" {
		t.Fatalf("expected forced tool name lw_so_ClassifierRelevance, got %v", tool.Value.Name)
	}
}
