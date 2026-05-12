package gatewaytracer

const (
	AttrGenAIOperationName      = "gen_ai.operation.name"
	AttrGenAISystem             = "gen_ai.system"
	AttrGenAIRequestModel       = "gen_ai.request.model"
	AttrGenAIRequestTemp        = "gen_ai.request.temperature"
	AttrGenAIRequestMaxTokens   = "gen_ai.request.max_tokens"
	AttrGenAIRequestTopP        = "gen_ai.request.top_p"
	AttrGenAIRequestFreqPen     = "gen_ai.request.frequency_penalty"
	AttrGenAIRequestPresPen     = "gen_ai.request.presence_penalty"
	AttrGenAIRequestStopSeqs    = "gen_ai.request.stop_sequences"
	AttrGenAIResponseID         = "gen_ai.response.id"
	AttrGenAIResponseModel      = "gen_ai.response.model"
	AttrGenAIResponseFinish     = "gen_ai.response.finish_reasons"
	AttrGenAIInputMessages      = "gen_ai.input.messages"
	AttrGenAIOutputMessages     = "gen_ai.output.messages"
	AttrGenAISystemInstructions = "gen_ai.system_instructions"
	AttrGenAIUsageIn            = "gen_ai.usage.input_tokens"
	AttrGenAIUsageOut           = "gen_ai.usage.output_tokens"
	AttrGenAIUsageTotal         = "gen_ai.usage.total_tokens"
	AttrGenAIUsageCacheRead     = "gen_ai.usage.cache_read.input_tokens"
	AttrGenAIUsageCacheCreate   = "gen_ai.usage.cache_creation.input_tokens"
)
