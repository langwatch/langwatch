package providers

import (
	"context"
	"net/http"
	"time"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// decisionsPath is OpenAI's Decisions API route. Bifrost's OpenAI passthrough
// joins it to the provider's base URL, so an OpenAI credential with a regional
// base URL (https://eu.api.openai.com, with or without /v1) is served there,
// and one without a base URL goes to api.openai.com.
const decisionsPath = "/v1/decisions"

// dispatchDecisions relays POST /v1/decisions to the OpenAI credential's
// endpoint. Bifrost has no typed Decisions request, so the body goes through
// its passthrough lane, which swaps the virtual key for the provider key on
// the way out. The answer comes back as the provider wrote it; a non-2xx
// answer keeps its status, and the dispatch walk turns it into an upstream
// error for the caller.
//
//nolint:revive // argument-limit: the same five values dispatchImageGeneration beside it takes.
func (r *BifrostRouter) dispatchDecisions(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	if cred.ProviderID != domain.ProviderOpenAI {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": "/v1/decisions is OpenAI's Decisions API and needs an OpenAI credential; " +
				"this credential is " + string(cred.ProviderID),
			"fault": "customer",
		})
	}
	if !gjson.ValidBytes(req.Body) || !gjson.ParseBytes(req.Body).IsObject() {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "invalid JSON body: expected an object"})
	}

	bfReq := &bfschemas.BifrostPassthroughRequest{
		Model:       model,
		Method:      http.MethodPost,
		Path:        decisionsPath,
		Body:        req.Body,
		SafeHeaders: map[string]string{"Content-Type": "application/json"},
	}
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	resp, berr := r.bf.Passthrough(bfCtx, r.responsesProvider(cred, provider), bfReq)
	if berr != nil {
		if answer, ok := r.responseFromBifrostError(berr, bfCtx, req.Type); ok {
			return answer, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	out := &domain.Response{
		Body:       resp.Body,
		StatusCode: status,
		Headers:    passthroughResponseHeaders(resp.Headers),
	}
	if status < http.StatusBadRequest {
		out.Usage = decisionsUsage(resp.Body)
	}
	return out, nil
}

// decisionsUsage reads the token counts a Decisions answer reports:
// input_tokens (cached ones included, stated apart under
// input_tokens_details), and output_tokens when the model produced any.
func decisionsUsage(body []byte) domain.Usage {
	in := int(gjson.GetBytes(body, "usage.input_tokens").Int())
	out := int(gjson.GetBytes(body, "usage.output_tokens").Int())
	cached := int(gjson.GetBytes(body, "usage.input_tokens_details.cached_tokens").Int())
	return domain.Usage{
		PromptTokens:     in,
		CompletionTokens: out,
		TotalTokens:      in + out,
		CacheReadTokens:  min(cached, in),
	}
}
