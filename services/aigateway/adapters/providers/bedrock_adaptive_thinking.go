package providers

import (
	"fmt"
	"regexp"
	"strconv"

	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
	bfbedrock "github.com/maximhq/bifrost/core/providers/bedrock"
	bfutils "github.com/maximhq/bifrost/core/providers/utils"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
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

// thinkingIntent is what the caller asked of the model's thinking.
type thinkingIntent struct {
	model   string
	effort  string
	display *string
}

// keepBedrockThinkingAdaptive turns the budget thinking block Bifrost wrote
// for a model it does not know as adaptive back into adaptive thinking, with
// the effort in output_config. A caller's budget becomes the effort it maps
// to. Reports whether the fields changed.
func keepBedrockThinkingAdaptive(converse *bfbedrock.BedrockConverseRequest, intent thinkingIntent) bool {
	if converse == nil || converse.AdditionalModelRequestFields == nil || !bifrostMissesAdaptiveThinking(intent.model) {
		return false
	}
	fields := converse.AdditionalModelRequestFields
	raw, ok := fields.Get("thinking")
	if !ok {
		return false
	}
	thinking, ok := raw.(map[string]any)
	if !ok || thinking["type"] != "enabled" {
		return false
	}
	effort := intent.effort
	if effort == "" || effort == "none" {
		effort = effortFromThinkingBudget(thinking["budget_tokens"], converse.InferenceConfig)
	}
	adaptive := map[string]any{"type": "adaptive", "display": "summarized"}
	if intent.display != nil && *intent.display != "" {
		adaptive["display"] = *intent.display
	}
	fields.Set("thinking", adaptive)
	setOrderedOutputConfig(fields, "effort", bfanthropic.MapBifrostEffortToAnthropic(effort))
	return true
}

// effortFromThinkingBudget maps a budget_tokens value onto the effort bucket
// it stands for against the request's output cap.
func effortFromThinkingBudget(budget any, cfg *bfbedrock.BedrockInferenceConfig) string {
	tokens, ok := bfschemas.SafeExtractInt(budget)
	if !ok {
		return "high"
	}
	maxTokens := bedrockDefaultCompletionMaxTokens
	if cfg != nil && cfg.MaxTokens != nil {
		maxTokens = *cfg.MaxTokens
	}
	effort := bfutils.GetReasoningEffortFromBudgetTokens(tokens, anthropicMinimumThinkingBudget, maxTokens)
	if effort == "none" {
		return "high"
	}
	return effort
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

// responsesThinkingDisplay maps a Responses reasoning summary onto the
// thinking display Bifrost's adaptive branch would pick.
func responsesThinkingDisplay(reasoning *bfschemas.ResponsesParametersReasoning) *string {
	if reasoning == nil || reasoning.Summary == nil {
		return nil
	}
	if *reasoning.Summary == "none" {
		return bfschemas.Ptr("omitted")
	}
	return bfschemas.Ptr("summarized")
}

// responsesReasoningEffort returns the request's reasoning effort, "" when unset.
func responsesReasoningEffort(bfReq *bfschemas.BifrostResponsesRequest) string {
	if bfReq.Params == nil || bfReq.Params.Reasoning == nil || bfReq.Params.Reasoning.Effort == nil {
		return ""
	}
	return *bfReq.Params.Reasoning.Effort
}

// keepResponsesThinkingAdaptive applies keepBedrockThinkingAdaptive to a
// Converse body converted from a Responses request.
func keepResponsesThinkingAdaptive(converse *bfbedrock.BedrockConverseRequest, bfReq *bfschemas.BifrostResponsesRequest) bool {
	var reasoning *bfschemas.ResponsesParametersReasoning
	if bfReq.Params != nil {
		reasoning = bfReq.Params.Reasoning
	}
	return keepBedrockThinkingAdaptive(converse, thinkingIntent{
		model:   bfReq.Model,
		effort:  responsesReasoningEffort(bfReq),
		display: responsesThinkingDisplay(reasoning),
	})
}

// responsesRequestReasons reports whether a Responses request asks for
// reasoning at all.
func responsesRequestReasons(bfReq *bfschemas.BifrostResponsesRequest) bool {
	if bfReq.Params == nil || bfReq.Params.Reasoning == nil {
		return false
	}
	r := bfReq.Params.Reasoning
	return r.MaxTokens != nil || (r.Effort != nil && *r.Effort != "" && *r.Effort != "none")
}

// pinBedrockAdaptiveThinkingChat converts a public-Bedrock chat request here
// and sends it raw when Bifrost would downgrade its adaptive thinking.
func pinBedrockAdaptiveThinkingChat(bfCtx *bfschemas.BifrostContext, bfReq *bfschemas.BifrostChatRequest) error {
	if bfReq == nil || bfReq.Provider != bfschemas.Bedrock || !bifrostMissesAdaptiveThinking(bfReq.Model) {
		return nil
	}
	if bfReq.Params == nil || bfReq.Params.Reasoning == nil {
		return nil
	}
	reasoning := bfReq.Params.Reasoning
	converse, err := bfbedrock.ToBedrockChatCompletionRequest(bfCtx, bfReq)
	if err != nil {
		return fmt.Errorf("convert request for bedrock: %w", err)
	}
	effort := ""
	if reasoning.Effort != nil {
		effort = *reasoning.Effort
	}
	if !keepBedrockThinkingAdaptive(converse, thinkingIntent{model: bfReq.Model, effort: effort, display: reasoning.Display}) {
		return nil
	}
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
