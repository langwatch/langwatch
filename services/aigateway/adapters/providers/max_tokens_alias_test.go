package providers

import (
	"bytes"
	"context"
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "translated lanes map legacy max_tokens onto the provider request"
// REPRO: a client cap sent as `max_tokens` was silently dropped on every
// translated lane. ChatParameters carries only max_completion_tokens, so
// the Anthropic / Bedrock / Gemini translators found no cap and substituted
// the model's own maximum: max_tokens: 5 answered with dozens of tokens and
// finish_reason "stop". The parse must lift the alias so the translators
// see the client's cap.
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestBuildChatRequest_TranslatedLanesLiftMaxTokensAlias(t *testing.T) {
	body := []byte(`{"model":"m","messages":[{"role":"user","content":"ping"}],"max_tokens":5}`)
	for _, provider := range []bfschemas.ModelProvider{
		bfschemas.Anthropic, bfschemas.Bedrock, bfschemas.Gemini, bfschemas.Vertex,
	} {
		req := &domain.Request{Type: domain.RequestTypeChat, Body: body}
		bfReq, _, err := buildChatRequest(context.Background(), req, provider, "m")
		if err != nil {
			t.Fatalf("%s: buildChatRequest returned error: %v", provider, err)
		}
		if bfReq.Params == nil || bfReq.Params.MaxCompletionTokens == nil {
			t.Fatalf("%s: max_tokens was dropped; MaxCompletionTokens is nil and the translator will substitute the model's default cap", provider)
		}
		if got := *bfReq.Params.MaxCompletionTokens; got != 5 {
			t.Fatalf("%s: MaxCompletionTokens = %d, want the client's max_tokens value 5", provider, got)
		}
	}
}

// @scenario "explicit max_completion_tokens wins over the max_tokens alias"
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestBuildChatRequest_ExplicitMaxCompletionTokensWinsOverAlias(t *testing.T) {
	body := []byte(`{"model":"m","messages":[],"max_tokens":5,"max_completion_tokens":9}`)
	req := &domain.Request{Type: domain.RequestTypeChat, Body: body}
	bfReq, _, err := buildChatRequest(context.Background(), req, bfschemas.Anthropic, "m")
	if err != nil {
		t.Fatalf("buildChatRequest returned error: %v", err)
	}
	if bfReq.Params.MaxCompletionTokens == nil || *bfReq.Params.MaxCompletionTokens != 9 {
		t.Fatalf("MaxCompletionTokens = %v, want the explicit max_completion_tokens 9 to win over the alias", bfReq.Params.MaxCompletionTokens)
	}
}

// Absent and null caps stay nil: the provider translator's documented
// default (Anthropic requires a max_tokens, so Bifrost injects the model
// maximum) is the correct behavior when the client asked for no cap.
func TestBuildChatRequest_AbsentOrNullMaxTokensStaysNil(t *testing.T) {
	for name, body := range map[string][]byte{
		"absent": []byte(`{"model":"m","messages":[]}`),
		"null":   []byte(`{"model":"m","messages":[],"max_tokens":null}`),
	} {
		req := &domain.Request{Type: domain.RequestTypeChat, Body: body}
		bfReq, _, err := buildChatRequest(context.Background(), req, bfschemas.Anthropic, "m")
		if err != nil {
			t.Fatalf("%s: buildChatRequest returned error: %v", name, err)
		}
		if bfReq.Params.MaxCompletionTokens != nil {
			t.Fatalf("%s: MaxCompletionTokens = %d, want nil (no client cap)", name, *bfReq.Params.MaxCompletionTokens)
		}
	}
}

// @scenario "a malformed max_tokens is rejected, not silently un-capped"
// A malformed cap must fail the request, not silently un-cap it. This
// mirrors the strictness of max_completion_tokens, which is typed *int and
// already rejects non-integer values at unmarshal.
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestBuildChatRequest_MalformedMaxTokensRejected(t *testing.T) {
	for name, body := range map[string][]byte{
		"string":  []byte(`{"model":"m","messages":[],"max_tokens":"five"}`),
		"decimal": []byte(`{"model":"m","messages":[],"max_tokens":5.7}`),
		"object":  []byte(`{"model":"m","messages":[],"max_tokens":{}}`),
		// Deliberate: a malformed alias is rejected even when a valid
		// max_completion_tokens would win. OpenAI's API documents that
		// every provided field is validated before precedence applies, so
		// accepting this body on the translated lanes would make them more
		// lenient than the reference behavior they translate.
		"string_with_valid_winner": []byte(`{"model":"m","messages":[],"max_tokens":"five","max_completion_tokens":9}`),
	} {
		req := &domain.Request{Type: domain.RequestTypeChat, Body: body}
		_, _, err := buildChatRequest(context.Background(), req, bfschemas.Anthropic, "m")
		if err == nil {
			t.Fatalf("%s: buildChatRequest accepted a malformed max_tokens; the request would dispatch uncapped", name)
		}
	}
}

// A body the parse rejects must surface to the client as a 400
// bad_request, not an internal error, on both dispatch lanes. The
// classification lives at the Dispatch / DispatchStream call sites, so
// it needs its own assertion beyond buildChatRequest's returned error.
func TestDispatch_MalformedChatBodyClassifiedBadRequest(t *testing.T) {
	router := &BifrostRouter{}
	req := &domain.Request{
		Type: domain.RequestTypeChat,
		Body: []byte(`{"model":"m","messages":[],"max_tokens":"five"}`),
	}
	cred := domain.Credential{ID: "mp-1", ProviderID: domain.ProviderAnthropic, APIKey: "sk"}

	_, err := router.Dispatch(context.Background(), req, cred)
	if err == nil {
		t.Fatal("Dispatch accepted a malformed body")
	}
	if !herr.IsCode(err, domain.ErrBadRequest) {
		t.Fatalf("Dispatch error = %v, want bad_request classification", err)
	}
	if !strings.Contains(err.Error(), "max_tokens must be an integer") {
		t.Fatalf("Dispatch error = %v, want the parse reason preserved so the client sees what to fix", err)
	}

	_, err = router.DispatchStream(context.Background(), req, cred)
	if err == nil {
		t.Fatal("DispatchStream accepted a malformed body")
	}
	if !herr.IsCode(err, domain.ErrBadRequest) {
		t.Fatalf("DispatchStream error = %v, want bad_request classification", err)
	}
	if !strings.Contains(err.Error(), "max_tokens must be an integer") {
		t.Fatalf("DispatchStream error = %v, want the parse reason preserved so the client sees what to fix", err)
	}
}

// @scenario "gpt-5-mini with legacy max_tokens parameter returns 400 from upstream"
// The raw-forward lanes are untouched by the alias lift: the body reaches
// OpenAI byte-for-byte and upstream applies its own alias rules (gpt-5*
// rejects max_tokens; older families cap on it). Translating here would
// change the documented v1 pass-through behavior.
// Spec: specs/ai-gateway/openai-param-compat.feature
func TestBuildChatRequest_OpenAIRawForwardKeepsMaxTokensBytes(t *testing.T) {
	body := []byte(`{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":5}`)
	req := &domain.Request{Type: domain.RequestTypeChat, Body: body}
	bfReq, _, err := buildChatRequest(context.Background(), req, bfschemas.OpenAI, "gpt-5-mini")
	if err != nil {
		t.Fatalf("buildChatRequest returned error: %v", err)
	}
	if !bytes.Equal(bfReq.RawRequestBody, body) {
		t.Fatalf("OpenAI lane must raw-forward max_tokens untouched;\n got: %s\nwant: %s", bfReq.RawRequestBody, body)
	}
}
