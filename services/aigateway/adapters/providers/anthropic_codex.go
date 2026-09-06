package providers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bytedance/sonic"
	"github.com/tidwall/gjson"

	bfopenai "github.com/maximhq/bifrost/core/providers/openai"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Claude Code /v1/messages on a codex-backed virtual key.
//
// The codex backend speaks the Responses API only, so an Anthropic Messages
// body can never be forwarded to it: the request is translated through the
// same neutral Responses request every other non-Anthropic destination uses,
// serialized into the OpenAI Responses wire shape, and dispatched over the
// existing codex SSE leg (OAuth bearer, one-shot 401 refresh, plan-limit
// forwarding). The result comes back through the shared Anthropic framer, so
// the SSE union guarantees hold identically to the Bifrost and Bedrock-VPCE
// translated lanes.

// buildCodexMessagesRequest translates the Anthropic body into the Responses
// request the codex dispatchers accept. The bare model name is what the
// vendored converter's model-family checks must see; the codex dispatcher
// re-pins the model on the wire body regardless.
func buildCodexMessagesRequest(
	bfCtx *bfschemas.BifrostContext,
	req *domain.Request,
	model string,
) (*domain.Request, error) {
	bare := strings.TrimPrefix(model, codexModelPrefix)
	bfReq, err := buildMessagesResponsesRequest(bfCtx, req, bfschemas.OpenAI, bare)
	if err != nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest, err.Error())
	}

	wire := bfopenai.ToOpenAIResponsesRequest(bfReq)
	if wire == nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest,
			"anthropic messages body could not be converted for codex")
	}
	body, err := sonic.Marshal(wire)
	if err != nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest,
			"anthropic messages body could not be encoded for codex")
	}

	return &domain.Request{
		Type:     domain.RequestTypeResponses,
		Model:    req.Model,
		Resolved: req.Resolved,
		Body:     body,
	}, nil
}

// dispatchMessagesTranslatedCodex serves a non-streaming /v1/messages request
// on a codex credential: translate, aggregate over the SSE-only backend, and
// re-assemble the Anthropic message envelope.
func (r *BifrostRouter) dispatchMessagesTranslatedCodex(
	ctx context.Context,
	req *domain.Request,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	derived, err := buildCodexMessagesRequest(bfCtx, req, model)
	if err != nil {
		return nil, err
	}

	resp, err := r.dispatchCodex(ctx, derived, model, cred)
	if err != nil {
		return nil, anthropicErrorFromCodex(err)
	}
	if resp == nil {
		return nil, anthropicUpstreamError(http.StatusBadGateway, "codex returned no response")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// dispatchCodex forwards upstream failures as plain HTTP responses in
		// the provider's own envelope; a /v1/messages client decodes only the
		// Anthropic one, so the status, message and retry headers are re-wrapped.
		wrapped := anthropicUpstreamError(resp.StatusCode, codexErrorMessage(resp.Body))
		wrapped.Headers = resp.Headers
		return nil, wrapped
	}

	var bfResp bfschemas.BifrostResponsesResponse
	if err := sonic.Unmarshal(resp.Body, &bfResp); err != nil {
		return nil, anthropicUpstreamError(http.StatusBadGateway, "codex response could not be decoded")
	}
	body, err := assembleAnthropicMessageBody(bfCtx, &bfResp, modelForClient(req, model))
	if err != nil {
		return nil, err
	}

	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      resp.Usage,
	}, nil
}

// dispatchMessagesTranslatedCodexStream is the streaming sibling. The codex
// frames are already Responses SSE events, so they are parsed and fed to the
// same translated iterator every other provider uses.
func (r *BifrostRouter) dispatchMessagesTranslatedCodexStream(
	ctx context.Context,
	req *domain.Request,
	model string,
	cred domain.Credential,
) (domain.StreamIterator, error) {
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	derived, err := buildCodexMessagesRequest(bfCtx, req, model)
	if err != nil {
		return nil, err
	}

	codex, err := r.dispatchCodexStream(ctx, derived, model, cred)
	if err != nil {
		return nil, anthropicErrorFromCodex(err)
	}

	ch := make(chan *bfschemas.BifrostStreamChunk, 8)
	go pumpCodexFramesAsResponsesEvents(ctx, codex, ch)

	return &anthropicTranslatedStreamIterator{
		ch:     ch,
		bfCtx:  bfCtx,
		framer: newAnthropicStreamFramer("", modelForClient(req, model)),
		logger: r.logger,
	}, nil
}

// pumpCodexFramesAsResponsesEvents parses the codex SSE frames into Responses
// stream events and feeds the translated iterator's channel, the same seam the
// Bedrock VPCE stream uses. An `error` event becomes a BifrostError chunk
// (mirroring Bifrost's own Responses stream handling) so the iterator closes
// every open block and reports the failure instead of framing it away.
func pumpCodexFramesAsResponsesEvents(
	ctx context.Context,
	codex domain.StreamIterator,
	ch chan<- *bfschemas.BifrostStreamChunk,
) {
	defer close(ch)
	defer func() { _ = codex.Close() }()

	for codex.Next(ctx) {
		payload, ok := codexFrameData(codex.Chunk())
		if !ok {
			continue
		}
		var ev bfschemas.BifrostResponsesStreamResponse
		if err := sonic.Unmarshal(payload, &ev); err != nil {
			// One undecodable frame must not kill the turn; the terminal
			// guarantee stays with the framer either way.
			continue
		}
		chunk := &bfschemas.BifrostStreamChunk{BifrostResponsesStreamResponse: &ev}
		if ev.Type == bfschemas.ResponsesStreamResponseTypeError {
			msg := "codex stream error"
			if ev.Message != nil && *ev.Message != "" {
				msg = *ev.Message
			}
			chunk = &bfschemas.BifrostStreamChunk{BifrostError: &bfschemas.BifrostError{
				IsBifrostError: false,
				Error:          &bfschemas.ErrorField{Message: msg},
			}}
		}
		select {
		case ch <- chunk:
		case <-ctx.Done():
			return
		}
	}

	if err := codex.Err(); err != nil && !errors.Is(err, context.Canceled) {
		select {
		case ch <- &bfschemas.BifrostStreamChunk{BifrostError: &bfschemas.BifrostError{
			IsBifrostError: false,
			Error:          &bfschemas.ErrorField{Message: err.Error()},
		}}:
		case <-ctx.Done():
		}
	}
}

// anthropicErrorFromCodex re-envelopes a codex dispatch failure for the
// /v1/messages surface. The codex leg reports errors in the OpenAI shape;
// Anthropic clients decode only their own envelope, so the status, retry
// headers and human message are carried over and the body is re-wrapped.
// Non-upstream errors (transport, refresh plumbing) pass through untouched.
func anthropicErrorFromCodex(err error) error {
	var upstream *domain.UpstreamError
	if !errors.As(err, &upstream) {
		return err
	}
	msg := codexErrorMessage(upstream.Body)
	if msg == "" {
		msg = upstream.Message
	}
	wrapped := anthropicUpstreamError(upstream.StatusCode, msg)
	wrapped.Headers = upstream.Headers
	return wrapped
}

// codexErrorMessage pulls the human-readable message out of an OpenAI-shaped
// error body, falling back to empty so the envelope renderer supplies its
// default.
func codexErrorMessage(body []byte) string {
	return gjson.GetBytes(body, "error.message").String()
}
