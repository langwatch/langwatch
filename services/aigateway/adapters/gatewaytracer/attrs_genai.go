package gatewaytracer

// These are the gen_ai keys the GATEWAY'S OWN operational span may carry:
// shape and cost metadata only — which model, how many tokens, what finished.
//
// The content keys (gen_ai.input.messages, gen_ai.output.messages,
// gen_ai.system_instructions) are deliberately ABSENT and must not be added
// back. Prompt and completion bodies belong to the customer and are set only by
// the customer trace bridge, on spans bound for the customer's own project,
// using that package's private keys. A constant declared here is one autocomplete
// away from being stamped on internal telemetry, so the key names do not exist
// in this package at all. ForbiddenInternalSpanAttrs and the tests in
// internal_span_test.go pin the boundary.
const (
	AttrGenAIOperationName    = "gen_ai.operation.name"
	AttrGenAISystem           = "gen_ai.system"
	AttrGenAIRequestModel     = "gen_ai.request.model"
	AttrGenAIRequestTemp      = "gen_ai.request.temperature"
	AttrGenAIRequestMaxTokens = "gen_ai.request.max_tokens"
	AttrGenAIRequestTopP      = "gen_ai.request.top_p"
	AttrGenAIRequestFreqPen   = "gen_ai.request.frequency_penalty"
	AttrGenAIRequestPresPen   = "gen_ai.request.presence_penalty"
	AttrGenAIRequestStopSeqs  = "gen_ai.request.stop_sequences"
	AttrGenAIResponseID       = "gen_ai.response.id"
	AttrGenAIResponseModel    = "gen_ai.response.model"
	AttrGenAIResponseFinish   = "gen_ai.response.finish_reasons"
	AttrGenAIUsageOut         = "gen_ai.usage.output_tokens"
	AttrGenAIUsageTotal       = "gen_ai.usage.total_tokens"
)
