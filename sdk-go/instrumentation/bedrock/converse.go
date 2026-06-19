package bedrock

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// Type aliases for the operation input/output structs, used by selectHandler's
// type switch. Aliasing keeps the dispatch table readable without importing the
// long package path at every use site.
type (
	bedrockruntimeConverseInput        = bedrockruntime.ConverseInput
	bedrockruntimeConverseOutput       = bedrockruntime.ConverseOutput
	bedrockruntimeConverseStreamInput  = bedrockruntime.ConverseStreamInput
	bedrockruntimeConverseStreamOutput = bedrockruntime.ConverseStreamOutput
	bedrockruntimeInvokeModelInput     = bedrockruntime.InvokeModelInput
	bedrockruntimeInvokeModelOutput    = bedrockruntime.InvokeModelOutput
)

// converseHandler instruments the unified, non-streaming Converse operation.
type converseHandler struct{}

func (converseHandler) operation() string { return "chat" }
func (converseHandler) streaming() bool   { return false }

func (converseHandler) recordRequest(span *langwatch.Span, params any, capture langwatch.DataCaptureMode) {
	input, ok := params.(*bedrockruntimeConverseInput)
	if !ok {
		return
	}
	recordConverseRequest(span, converseRequest{
		modelID:         derefString(input.ModelId),
		messages:        input.Messages,
		system:          input.System,
		inferenceConfig: input.InferenceConfig,
		toolConfig:      input.ToolConfig,
	}, capture)
}

func (converseHandler) recordResponse(_ context.Context, span *langwatch.Span, result any, capture langwatch.DataCaptureMode, _ time.Time) bool {
	output, ok := result.(*bedrockruntimeConverseOutput)
	if !ok {
		return false
	}

	if output.StopReason != "" {
		span.SetGenAIResponseFinishReasons(string(output.StopReason))
	}
	recordTokenUsage(span, output.Usage)
	if output.Metrics != nil && output.Metrics.LatencyMs != nil {
		recordLatency(span, *output.Metrics.LatencyMs)
	}
	recordConverseOutput(span, output.Output, capture)
	return false
}

// converseRequest carries the request fields Converse and ConverseStream share,
// so the request-mapping logic is written once.
type converseRequest struct {
	modelID         string
	messages        []types.Message
	system          []types.SystemContentBlock
	inferenceConfig *types.InferenceConfiguration
	toolConfig      *types.ToolConfiguration
}

// recordConverseRequest records the shared Converse(Stream) request attributes:
// model (+ span name), inference params, tools, system instructions and the
// input messages (gated by capture).
func recordConverseRequest(span *langwatch.Span, req converseRequest, capture langwatch.DataCaptureMode) {
	if req.modelID != "" {
		span.SetRequestModel(req.modelID)
		span.SetName(spanNameForModel(req.modelID))
	}

	recordInferenceConfig(span, req.inferenceConfig)

	if req.toolConfig != nil && len(req.toolConfig.Tools) > 0 {
		setJSONAttribute(span, "gen_ai.request.tools", req.toolConfig.Tools)
	}

	if capture.CaptureInput() {
		if instructions := systemText(req.system); instructions != "" {
			span.SetGenAISystemInstructions(instructions)
		}
		if len(req.messages) > 0 {
			span.SetGenAIInputMessages(messagesToChat(req.messages))
		}
	}
}

// recordConverseOutput records the assistant message from a Converse response as
// output chat messages plus the flattened output text (gated by capture).
func recordConverseOutput(span *langwatch.Span, output types.ConverseOutput, capture langwatch.DataCaptureMode) {
	if !capture.CaptureOutput() {
		return
	}
	msgOut, ok := output.(*types.ConverseOutputMemberMessage)
	if !ok {
		return
	}
	chat := messageToChat(msgOut.Value.Role, msgOut.Value.Content)
	span.SetGenAIOutputMessages([]langwatch.ChatMessage{chat})
}

// spanNameForModel builds the span name from a model id, matching the
// "<operation>.<model>" convention of the other LangWatch Go instrumentations.
func spanNameForModel(modelID string) string {
	return "chat." + modelID
}
