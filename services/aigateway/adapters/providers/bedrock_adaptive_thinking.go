package providers

import (
	"fmt"
	"regexp"
	"strconv"

	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
	bfbedrock "github.com/maximhq/bifrost/core/providers/bedrock"
	bfutils "github.com/maximhq/bifrost/core/providers/utils"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// claudeGenerationPattern captures the major version of a Claude model id in
// any of its spellings (claude-opus-5-5, global.anthropic.claude-sonnet-5-5,
// claude-fable-5-2).
var claudeGenerationPattern = regexp.MustCompile(`claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)`)

// claudeTakesAdaptiveThinking reports whether a Claude model takes
// thinking.type "adaptive". Bifrost v1.5.17 knows Opus and Sonnet 4.6 and
// Opus 4.7 to 4.8; every Claude 5 generation model takes it too, and Opus 5
// on Bedrock refuses the budget form Bifrost falls back to.
func claudeTakesAdaptiveThinking(model string) bool {
	return bfanthropic.SupportsAdaptiveThinking(model) || claudeMajorVersion(model) >= 5
}

// claudeMajorVersion returns the generation of a Claude model id, 0 when the
// id is not a Claude model.
func claudeMajorVersion(model string) int {
	match := claudeGenerationPattern.FindStringSubmatch(model)
	if match == nil {
		return 0
	}
	major, err := strconv.Atoi(match[1])
	if err != nil {
		return 0
	}
	return major
}

// bifrostMissesAdaptiveThinking reports whether Bifrost's Bedrock conversion
// would turn a reasoning request for this model into budget thinking the model
// does not take.
func bifrostMissesAdaptiveThinking(model string) bool {
	return claudeTakesAdaptiveThinking(model) && !bfanthropic.SupportsAdaptiveThinking(model)
}

// thinkingIntent is what the caller asked of the model's thinking. model is
// the id Bifrost dispatches, after the credential's deployment map.
type thinkingIntent struct {
	model   string
	effort  string
	budget  *int
	display *string
}

// needsPinning reports whether Bifrost's conversion would downgrade this
// request's thinking.
func (i thinkingIntent) needsPinning() bool {
	if !bifrostMissesAdaptiveThinking(i.model) {
		return false
	}
	return (i.effort != "" && i.effort != "none") || (i.budget != nil && *i.budget != 0)
}

// adaptiveEffort is the effort the request asked for: its own, or the bucket
// its budget maps to against the output cap.
func (i thinkingIntent) adaptiveEffort(cfg *bfbedrock.BedrockInferenceConfig) string {
	if i.effort != "" && i.effort != "none" {
		return i.effort
	}
	if i.budget == nil {
		return "high"
	}
	if *i.budget < 0 {
		return "low"
	}
	maxTokens := bedrockDefaultCompletionMaxTokens
	if cfg != nil && cfg.MaxTokens != nil {
		maxTokens = *cfg.MaxTokens
	}
	return bfutils.GetReasoningEffortFromBudgetTokens(*i.budget, anthropicMinimumThinkingBudget, maxTokens)
}

// applyAdaptiveThinking writes adaptive thinking, with the effort in
// output_config, over whatever thinking block the conversion wrote.
func applyAdaptiveThinking(converse *bfbedrock.BedrockConverseRequest, intent thinkingIntent) {
	if converse.AdditionalModelRequestFields == nil {
		converse.AdditionalModelRequestFields = bfschemas.NewOrderedMap()
	}
	adaptive := map[string]any{"type": "adaptive", "display": "summarized"}
	if intent.display != nil && *intent.display != "" {
		adaptive["display"] = *intent.display
	}
	converse.AdditionalModelRequestFields.Set("thinking", adaptive)
	setOrderedOutputConfig(converse.AdditionalModelRequestFields, "effort",
		bfanthropic.MapBifrostEffortToAnthropic(intent.adaptiveEffort(converse.InferenceConfig)))
}

// setOrderedOutputConfig sets one key of output_config, keeping the keys
// already there (a json_schema format, say).
func setOrderedOutputConfig(fields *bfschemas.OrderedMap, key string, value any) {
	current := bfschemas.NewOrderedMap()
	if existing, ok := fields.Get("output_config"); ok {
		switch cfg := existing.(type) {
		case *bfschemas.OrderedMap:
			if cfg != nil {
				current = cfg
			}
		case map[string]any:
			for k, v := range cfg {
				current.Set(k, v)
			}
		}
	}
	current.Set(key, value)
	fields.Set("output_config", current)
}

// responsesThinkingIntent reads the thinking a Responses request asks for.
func responsesThinkingIntent(bfReq *bfschemas.BifrostResponsesRequest, model string) thinkingIntent {
	intent := thinkingIntent{model: model}
	if bfReq.Params == nil || bfReq.Params.Reasoning == nil {
		return intent
	}
	reasoning := bfReq.Params.Reasoning
	if reasoning.Effort != nil {
		intent.effort = *reasoning.Effort
	}
	intent.budget = reasoning.MaxTokens
	if reasoning.Summary != nil {
		display := "summarized"
		if *reasoning.Summary == "none" {
			display = "omitted"
		}
		intent.display = &display
	}
	return intent
}

// convertResponsesForBedrock runs the vendored Converse conversion against
// the model Bifrost dispatches. When that conversion would downgrade adaptive
// thinking, it runs without the reasoning (whose budget arithmetic can refuse
// small output caps) and adaptive thinking is written from the request
// instead.
func convertResponsesForBedrock(bfCtx *bfschemas.BifrostContext, bfReq *bfschemas.BifrostResponsesRequest, model string) (*bfbedrock.BedrockConverseRequest, error) {
	intent := responsesThinkingIntent(bfReq, model)
	conv := *bfReq
	conv.Model = model
	pin := intent.needsPinning()
	if pin {
		params := *bfReq.Params
		params.Reasoning = nil
		conv.Params = &params
	}
	converse, err := bfbedrock.ToBedrockResponsesRequest(bfCtx, &conv)
	if err != nil {
		return nil, err
	}
	if pin {
		applyAdaptiveThinking(converse, intent)
	}
	return converse, nil
}

// pinBedrockAdaptiveThinkingChat converts a public-Bedrock chat request here
// and sends it raw when Bifrost would downgrade its adaptive thinking.
func pinBedrockAdaptiveThinkingChat(bfCtx *bfschemas.BifrostContext, bfReq *bfschemas.BifrostChatRequest, cred domain.Credential) error {
	if bfReq == nil || bfReq.Provider != bfschemas.Bedrock || bfReq.Params == nil || bfReq.Params.Reasoning == nil {
		return nil
	}
	reasoning := bfReq.Params.Reasoning
	intent := thinkingIntent{model: bedrockModelID(bfReq.Model, cred), budget: reasoning.MaxTokens, display: reasoning.Display}
	if reasoning.Effort != nil {
		intent.effort = *reasoning.Effort
	}
	if !intent.needsPinning() {
		return nil
	}
	conv := *bfReq
	conv.Model = intent.model
	params := *bfReq.Params
	params.Reasoning = nil
	conv.Params = &params
	converse, err := bfbedrock.ToBedrockChatCompletionRequest(bfCtx, &conv)
	if err != nil {
		return fmt.Errorf("convert request for bedrock: %w", err)
	}
	applyAdaptiveThinking(converse, intent)
	body, err := marshalConverseBody(bfCtx, converse)
	if err != nil {
		return err
	}
	bfReq.RawRequestBody = body
	bfCtx.SetValue(bfschemas.BifrostContextKeyUseRawRequestBody, true)
	return nil
}

// marshalConverseBody encodes a Converse body the way Bifrost would before
// sending it, extra params included when passthrough is on.
func marshalConverseBody(bfCtx *bfschemas.BifrostContext, converse *bfbedrock.BedrockConverseRequest) ([]byte, error) {
	body, err := bfutils.MarshalSorted(converse)
	if err != nil {
		return nil, fmt.Errorf("encode bedrock request: %w", err)
	}
	if passthrough, _ := bfCtx.Value(bfschemas.BifrostContextKeyPassthroughExtraParams).(bool); passthrough {
		if extra := converse.GetExtraParams(); len(extra) > 0 {
			if body, err = bfutils.MergeExtraParamsIntoJSON(body, extra); err != nil {
				return nil, fmt.Errorf("encode bedrock request: %w", err)
			}
		}
	}
	return body, nil
}
