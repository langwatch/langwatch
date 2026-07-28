package providers

import (
	"context"
	"errors"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	brdocument "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	brtypes "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	smithyhttp "github.com/aws/smithy-go/transport/http"

	bfbedrock "github.com/maximhq/bifrost/core/providers/bedrock"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Managed-Bedrock /v1/messages over the customer's private runtime endpoint.
//
// The translated messages lane normally dispatches through Bifrost, which
// signs SigV4 over the public bedrock-runtime host. A managed-Bedrock
// credential carries a customer-owned VPC endpoint whose IAM policy commonly
// authorizes InvokeModel only when the request arrives through that endpoint,
// and even when the policy is permissive the customer configured private
// networking on purpose. So VPCE-bearing credentials dispatch through the
// pinned aws-sdk client here, the same machinery the chat lane uses, with the
// request translated from the Anthropic body and the response assembled back
// into the Anthropic envelope.

// dispatchMessagesTranslatedBedrockVPCE serves a non-streaming translated
// /v1/messages request over the customer's VPC endpoint.
func (r *BifrostRouter) dispatchMessagesTranslatedBedrockVPCE(
	ctx context.Context,
	bfCtx *bfschemas.BifrostContext,
	bfReq *bfschemas.BifrostResponsesRequest,
	model string,
	cred domain.Credential,
	endpoint string,
) (*domain.Response, error) {
	input, err := converseInputFromResponsesRequest(bfCtx, bfReq, model, cred)
	if err != nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest, err.Error())
	}

	client := newBedrockRuntimeClient(cred, endpoint)
	out, err := client.Converse(ctx, input)
	if err != nil {
		return nil, anthropicBedrockError(err)
	}

	bfResp := converseOutputToBifrost(out, model)
	body, err := assembleAnthropicMessageBody(bfCtx, bfResp.ToBifrostResponsesResponse(), model)
	if err != nil {
		return nil, err
	}

	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      bedrockUsage(out.Usage),
	}, nil
}

// dispatchMessagesTranslatedBedrockVPCEStream is the streaming sibling. The
// Bedrock events are pulled through the chat iterator's typed seam, converted
// to Responses stream events by the vendored state machine, and fed to the
// same translated iterator every other provider uses, so the Anthropic framing
// guarantees hold identically here.
func (r *BifrostRouter) dispatchMessagesTranslatedBedrockVPCEStream(
	ctx context.Context,
	bfCtx *bfschemas.BifrostContext,
	bfReq *bfschemas.BifrostResponsesRequest,
	req *domain.Request,
	model string,
	cred domain.Credential,
	endpoint string,
) (domain.StreamIterator, error) {
	input, err := converseInputFromResponsesRequest(bfCtx, bfReq, model, cred)
	if err != nil {
		return nil, anthropicUpstreamError(http.StatusBadRequest, err.Error())
	}

	streamInput := &bedrockruntime.ConverseStreamInput{
		ModelId:                      input.ModelId,
		Messages:                     input.Messages,
		System:                       input.System,
		InferenceConfig:              input.InferenceConfig,
		ToolConfig:                   input.ToolConfig,
		AdditionalModelRequestFields: input.AdditionalModelRequestFields,
	}

	client := newBedrockRuntimeClient(cred, endpoint)
	out, err := client.ConverseStream(ctx, streamInput)
	if err != nil {
		return nil, anthropicBedrockError(err)
	}

	bedrock := &bedrockStreamIterator{
		ctx:    ctx,
		stream: out.GetStream(),
		model:  model,
	}

	ch := make(chan *bfschemas.BifrostStreamChunk, 8)
	go pumpBedrockChunksAsResponsesEvents(ctx, bedrock, ch)

	return &anthropicTranslatedStreamIterator{
		ch:     ch,
		bfCtx:  bfCtx,
		framer: newAnthropicStreamFramer("", modelForClient(req, model)),
		logger: r.logger,
	}, nil
}

// converseInputFromResponsesRequest maps the neutral Responses request (built
// from the Anthropic body) onto Bedrock's Converse input. Messages and tools
// ride the chat lane's aws-sdk mappers; the inference config and the
// model-specific reasoning fields come from the vendored Responses conversion,
// the same function Bifrost runs for public Bedrock. That reuse is what keeps
// Claude Code's `thinking` request intact on the private endpoint: the
// vendored conversion turns the translated reasoning into Bedrock's
// `additionalModelRequestFields` (`thinking`/`output_config` for Anthropic
// models, `reasoningConfig` for Nova), and hand-rolling that mapping here
// would drift from the public lane the moment either changes.
func converseInputFromResponsesRequest(
	bfCtx *bfschemas.BifrostContext,
	bfReq *bfschemas.BifrostResponsesRequest,
	model string,
	cred domain.Credential,
) (*bedrockruntime.ConverseInput, error) {
	chatReq := bfReq.ToChatRequest()
	if chatReq == nil {
		return nil, errors.New("anthropic messages body could not be converted for Bedrock")
	}

	system, messages, err := mapBedrockMessages(chatReq.Input)
	if err != nil {
		return nil, err
	}

	// Only the params matter to the vendored conversion here; the messages
	// were already mapped above, so Input is cleared to skip a second
	// conversion pass that could only add a redundant failure mode.
	slim := *bfReq
	slim.Input = nil
	vendored, err := bfbedrock.ToBedrockResponsesRequest(bfCtx, &slim)
	if err != nil {
		return nil, err
	}

	input := &bedrockruntime.ConverseInput{
		ModelId:         aws.String(bedrockModelID(model, cred)),
		Messages:        messages,
		System:          system,
		InferenceConfig: convertBedrockInferenceConfig(vendored.InferenceConfig),
		ToolConfig:      mapBedrockToolConfig(chatReq.Params),
	}
	if fields := vendored.AdditionalModelRequestFields; fields != nil && fields.Len() > 0 {
		input.AdditionalModelRequestFields = brdocument.NewLazyDocument(fields.ToMap())
	}
	return input, nil
}

// convertBedrockInferenceConfig maps the vendored conversion's inference
// config onto the aws-sdk type. Returns nil when no knobs are set so an empty
// inferenceConfig object never reaches the wire.
func convertBedrockInferenceConfig(cfg *bfbedrock.BedrockInferenceConfig) *brtypes.InferenceConfiguration {
	if cfg == nil {
		return nil
	}
	out := &brtypes.InferenceConfiguration{}
	set := false
	if cfg.MaxTokens != nil {
		out.MaxTokens = int32Ptr(*cfg.MaxTokens)
		set = true
	}
	if cfg.Temperature != nil {
		out.Temperature = float32Ptr(*cfg.Temperature)
		set = true
	}
	if cfg.TopP != nil {
		out.TopP = float32Ptr(*cfg.TopP)
		set = true
	}
	if len(cfg.StopSequences) > 0 {
		out.StopSequences = cfg.StopSequences
		set = true
	}
	if !set {
		return nil
	}
	return out
}

// pumpBedrockChunksAsResponsesEvents drives the Bedrock stream's typed seam
// and feeds Responses events to the translated iterator's channel.
//
// One reordering is load-bearing: Bedrock emits the finish reason
// (messageStop) and the usage (metadata) as two separate events, in that
// order. The chat-to-Responses state machine emits its terminal
// response.completed on the finish chunk and reads usage off that same chunk,
// so forwarded naively the usage would arrive one chunk too late and be lost
// to both the client's message_delta and billing. The pump holds a
// finish-carrying chunk until the usage chunk arrives and forwards them
// merged.
func pumpBedrockChunksAsResponsesEvents(
	ctx context.Context,
	bedrock *bedrockStreamIterator,
	ch chan<- *bfschemas.BifrostStreamChunk,
) {
	defer close(ch)
	defer func() { _ = bedrock.Close() }()

	state := bfschemas.AcquireChatToResponsesStreamState()
	defer bfschemas.ReleaseChatToResponsesStreamState(state)

	forward := func(chunk *bfschemas.BifrostChatResponse) {
		for _, ev := range chunk.ToBifrostResponsesStreamResponse(state) {
			select {
			case ch <- &bfschemas.BifrostStreamChunk{BifrostResponsesStreamResponse: ev}:
			case <-ctx.Done():
			}
		}
	}

	var heldFinish *bfschemas.BifrostChatResponse
	for {
		chunk, ok := bedrock.nextTyped(ctx)
		if !ok {
			break
		}
		if heldFinish != nil {
			if chunk.Usage != nil {
				heldFinish.Usage = chunk.Usage
				forward(heldFinish)
				heldFinish = nil
				continue
			}
			forward(heldFinish)
			heldFinish = nil
		}
		if chunkCarriesFinish(chunk) && chunk.Usage == nil {
			heldFinish = chunk
			continue
		}
		forward(chunk)
	}
	if heldFinish != nil {
		forward(heldFinish)
	}

	if err := bedrock.Err(); err != nil && !errors.Is(err, context.Canceled) {
		select {
		case ch <- &bfschemas.BifrostStreamChunk{BifrostError: &bfschemas.BifrostError{
			IsBifrostError: false,
			Error:          &bfschemas.ErrorField{Message: err.Error()},
		}}:
		case <-ctx.Done():
		}
	}
}

// chunkCarriesFinish reports whether any choice on the chunk carries a finish
// reason.
func chunkCarriesFinish(chunk *bfschemas.BifrostChatResponse) bool {
	for i := range chunk.Choices {
		if chunk.Choices[i].FinishReason != nil && *chunk.Choices[i].FinishReason != "" {
			return true
		}
	}
	return false
}

// anthropicBedrockError wraps an aws-sdk dispatch failure in the Anthropic
// envelope the /v1/messages surface owes its clients, preserving the upstream
// status when the SDK exposes one.
func anthropicBedrockError(err error) *domain.UpstreamError {
	status := http.StatusBadGateway
	var respErr *smithyhttp.ResponseError
	if errors.As(err, &respErr) && respErr.Response != nil && respErr.Response.StatusCode > 0 {
		status = respErr.Response.StatusCode
	}
	return anthropicUpstreamError(status, err.Error())
}
