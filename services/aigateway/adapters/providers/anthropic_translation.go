package providers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/bytedance/sonic"
	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// isAnthropicWireProvider reports whether the resolved destination speaks the
// Anthropic Messages wire format natively, so a /v1/messages body can be
// raw-forwarded byte-for-byte.
//
// Two provider keys qualify, and both run Bifrost's Anthropic adapter, the
// only one with an Anthropic-native passthrough (POST /v1/messages with
// x-api-key + anthropic-version):
//
//   - the plain Anthropic provider, api.anthropic.com;
//   - the per-endpoint derived keys minted for a self-hosted
//     Anthropic-compatible server, whose base type is Anthropic and whose URL
//     rides on the provider config rather than the key.
//
// Byte identity matters for both: it is what keeps prompt-cache prefixes
// hitting and what preserves `thinking`, `cache_control` and the cache-token
// telemetry the passthrough usage parser reads back off the wire. Matching
// only the plain key would quietly divert every self-hosted endpoint onto the
// translated lane and undo that.
//
// Every other destination gets the translation lane. Bedrock and Vertex host
// Anthropic models but do not expose an Anthropic-shaped HTTP surface: Bedrock
// speaks Converse and its PassthroughStream returns unsupported-operation with
// no fallback, which is why streaming /v1/messages on a Bedrock virtual key
// hangs today. Routing them through the translated lane is what fixes that.
func isAnthropicWireProvider(p bfschemas.ModelProvider) bool {
	return p == bfschemas.Anthropic || strings.HasPrefix(string(p), anthropicCompatPrefix)
}

// anthropicMessageIDCounter backs the synthetic message ids handed to clients
// on the translated lane when the upstream response carries none. Anthropic
// clients treat `message.id` as opaque but require it to be present and stable
// for the duration of one message.
var anthropicMessageIDCounter atomic.Uint64

func syntheticAnthropicMessageID() string {
	return fmt.Sprintf("msg_lwgw_%d", anthropicMessageIDCounter.Add(1))
}

// buildMessagesResponsesRequest parses an Anthropic /v1/messages body into
// Bifrost's neutral Responses request so it can be translated to any provider.
//
// The heavy lifting is vendored: AnthropicMessageRequest.ToBifrostResponsesRequest
// already maps system prompts, tools, tool_choice, thinking, cache_control,
// images and the tool_use/tool_result round trip. What this adds is gateway
// authority over the destination: the virtual key decided the provider and
// model, so both are overwritten after the conversion, and the body's own
// `fallbacks` hint is dropped because the gateway runs its own fallback chain.
func buildMessagesResponsesRequest(
	bfCtx *bfschemas.BifrostContext,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
) (*bfschemas.BifrostResponsesRequest, error) {
	if len(req.Body) == 0 {
		return nil, fmt.Errorf("empty messages request body")
	}

	var anthReq bfanthropic.AnthropicMessageRequest
	if err := sonic.Unmarshal(req.Body, &anthReq); err != nil {
		return nil, fmt.Errorf("parse anthropic messages body: %w", err)
	}
	if len(anthReq.Messages) == 0 {
		return nil, fmt.Errorf("anthropic messages body has no messages")
	}

	bfReq := anthReq.ToBifrostResponsesRequest(bfCtx)
	if bfReq == nil {
		return nil, fmt.Errorf("anthropic messages body could not be converted")
	}

	bfReq.Provider = provider
	bfReq.Model = model
	bfReq.Fallbacks = nil
	normalizeReasoningBudget(bfReq)

	return bfReq, nil
}

// normalizeReasoningBudget turns an Anthropic thinking budget into a reasoning
// effort before the request leaves for a non-Anthropic provider.
//
// `thinking.budget_tokens` is an absolute token count that only means anything
// against Anthropic's own limits. Carried across verbatim it is not merely
// imprecise, it is fatal: Claude Code asks for 31999 tokens, Gemini 2.5 Flash
// caps thinking at 24576, and the provider's converter rejects the whole
// request rather than clamping, so every Claude Code turn fails. Effort buckets
// are the portable currency here, because each provider maps a bucket onto its
// own valid range. The bucket itself always comes from the vendored converter,
// which sets one in every thinking branch; this function only strips the
// non-portable unit.
//
// The turn keeps its reasoning either way. Only the units change, and only on
// the translated lane: the Anthropic lane never reaches this code and its
// budget stays exact.
func normalizeReasoningBudget(bfReq *bfschemas.BifrostResponsesRequest) {
	if bfReq == nil || bfReq.Params == nil || bfReq.Params.Reasoning == nil {
		return
	}
	reasoning := bfReq.Params.Reasoning
	if reasoning.MaxTokens == nil {
		return
	}
	reasoning.MaxTokens = nil
	if reasoning.Effort == nil {
		// Unreachable from a real /v1/messages body: the vendored converter
		// sets an effort in every thinking branch (the caller's own value,
		// the budget-derived ratio, or its "high" default). Kept as a
		// defensive floor so clearing the budget can never silently strip
		// the reasoning intent.
		reasoning.Effort = bfschemas.Ptr("high")
	}
}

// dispatchMessagesTranslated serves a non-streaming /v1/messages request whose
// destination does not speak the Anthropic wire format. The body is translated
// into Bifrost's neutral Responses request, dispatched, and the result is
// re-assembled into an Anthropic message envelope.
func (r *BifrostRouter) dispatchMessagesTranslated(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	bfReq, err := buildMessagesResponsesRequest(bfCtx, req, provider, model)
	if err != nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest, err.Error())
	}

	// Managed Bedrock with a private runtime endpoint must not reach the
	// public Bedrock host: the customer's IAM policy is commonly conditioned
	// on the VPCE, and even when it is not, they configured private
	// networking on purpose. Bifrost signs over the public host, so this
	// dispatch goes through the pinned aws-sdk client instead.
	if endpoint, epErr := resolveBedrockVPCEEndpoint(cred); epErr != nil {
		return nil, epErr
	} else if endpoint != "" {
		return r.dispatchMessagesTranslatedBedrockVPCE(ctx, bfCtx, bfReq, model, cred, endpoint)
	}

	resp, berr := r.bf.ResponsesRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, anthropicErrorFromBifrost(berr)
	}
	if resp == nil {
		return nil, anthropicUpstreamError(http.StatusBadGateway, "provider returned no response")
	}

	body, err := assembleAnthropicMessageBody(bfCtx, resp, model)
	if err != nil {
		return nil, err
	}

	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractResponsesUsage(resp),
	}, nil
}

// assembleAnthropicMessageBody turns a Bifrost Responses result into the
// Anthropic message envelope a /v1/messages client decodes: id, model, the
// assistant role, content blocks, stop reason and usage. Shared by the Bifrost
// and Bedrock-VPCE translated lanes so the envelope rules live once.
func assembleAnthropicMessageBody(
	bfCtx *bfschemas.BifrostContext,
	resp *bfschemas.BifrostResponsesResponse,
	model string,
) ([]byte, error) {
	anthResp := bfanthropic.ToAnthropicResponsesResponse(bfCtx, resp)
	if anthResp == nil {
		return nil, anthropicUpstreamError(http.StatusBadGateway, "provider response could not be translated")
	}
	if anthResp.ID == "" {
		anthResp.ID = syntheticAnthropicMessageID()
	}
	if anthResp.Model == "" {
		anthResp.Model = model
	}
	if anthResp.Content == nil {
		anthResp.Content = []bfanthropic.AnthropicContentBlock{}
	}
	// A reply carrying a tool call ends in tool_use, whatever the provider
	// reported. Providers that translate through their own chat shape lose the
	// distinction and answer end_turn, which tells the client the turn is over
	// and leaves the tool call unrun. Mirrors the streaming framer.
	if anthResp.StopReason == bfanthropic.AnthropicStopReasonEndTurn && hasToolUseBlock(anthResp.Content) {
		anthResp.StopReason = bfanthropic.AnthropicStopReasonToolUse
	}

	body, marshalErr := sonic.Marshal(anthResp)
	if marshalErr != nil {
		return nil, anthropicUpstreamError(http.StatusBadGateway, "provider response could not be encoded")
	}
	return body, nil
}

// dispatchMessagesTranslatedStream is the streaming sibling. Bifrost's
// ResponsesStream reaches every provider (natively where one exists, through
// the chat-completions fallback everywhere else), and the framer turns its
// events into the Anthropic union Claude Code validates.
func (r *BifrostRouter) dispatchMessagesTranslatedStream(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (domain.StreamIterator, error) {
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	bfReq, err := buildMessagesResponsesRequest(bfCtx, req, provider, model)
	if err != nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest, err.Error())
	}

	// Same endpoint pinning as the non-streaming lane above.
	if endpoint, epErr := resolveBedrockVPCEEndpoint(cred); epErr != nil {
		return nil, epErr
	} else if endpoint != "" {
		return r.dispatchMessagesTranslatedBedrockVPCEStream(ctx, bfCtx, bfReq, req, model, cred, endpoint)
	}

	ch, berr := r.bf.ResponsesStreamRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, anthropicErrorFromBifrost(berr)
	}

	return &anthropicTranslatedStreamIterator{
		ch:     ch,
		bfCtx:  bfCtx,
		framer: newAnthropicStreamFramer("", modelForClient(req, model)),
		logger: r.logger,
	}, nil
}

// resolveBedrockVPCEEndpoint is the fail-closed gate for private-endpoint
// routing, shared by the streaming and non-streaming translated lanes. An
// invalid endpoint comes back as the Anthropic-shaped 400 both lanes owe
// their clients; keeping the check in one place means the error contract and
// any future bypass condition cannot drift between the two.
func resolveBedrockVPCEEndpoint(cred domain.Credential) (string, error) {
	endpoint, err := bedrockVPCEEndpoint(cred)
	if err != nil {
		return "", anthropicUpstreamError(http.StatusBadRequest, err.Error())
	}
	return endpoint, nil
}

// modelForClient picks the model name echoed back to the client. Anthropic
// clients compare it against what they asked for, so the inbound name wins
// when present and the resolved id is the fallback.
func modelForClient(req *domain.Request, resolved string) string {
	if req != nil && req.Model != "" && !strings.Contains(req.Model, "/") {
		return req.Model
	}
	return resolved
}

// hasToolUseBlock reports whether a content block array contains a tool call.
func hasToolUseBlock(blocks []bfanthropic.AnthropicContentBlock) bool {
	for i := range blocks {
		switch blocks[i].Type {
		case bfanthropic.AnthropicContentBlockTypeToolUse,
			bfanthropic.AnthropicContentBlockTypeServerToolUse,
			bfanthropic.AnthropicContentBlockTypeMCPToolUse:
			return true
		default:
			continue
		}
	}
	return false
}
