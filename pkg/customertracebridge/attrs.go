package customertracebridge

// Attribute keys stamped on customer-facing trace data. Single source for
// both this package (customer-bound spans) and the gateway's own operational
// tracer (gatewaytracer imports these for its scalar-only internal copies).
// The origin KEY lives in pkg/otelsetup (AttrLangWatchOrigin); origin VALUES
// are service identity and are declared by each service, in its own Policy.
const (
	AttrVirtualKeyID = "langwatch.virtual_key_id"
	AttrGatewayReqID = "langwatch.gateway_request_id"
	// AttrModelProviderID is the ModelProvider row id the request was
	// dispatched to. The control plane reads this exact key to decide which
	// provider-filtered budgets a debit belongs to
	// (gatewayBudgetDebits.mapProjection.ts reads it off the span, and
	// trace-attribute-accumulation.service.ts allowlists it onto the trace
	// fold for everything else); a dispatch without it debits unfiltered
	// budgets only.
	AttrModelProviderID       = "langwatch.model_provider_id"
	AttrGenAIUsageIn          = "gen_ai.usage.input_tokens"
	AttrGenAIUsageCacheRead   = "gen_ai.usage.cache_read.input_tokens"
	AttrGenAIUsageCacheCreate = "gen_ai.usage.cache_creation.input_tokens"
	AttrGenAIConversationID   = "gen_ai.conversation.id"

	// Audio usage measures (no upstream semconv exists yet for either):
	// characters synthesized by a TTS call and seconds of audio transcribed
	// by an STT call, the units character- and duration-priced audio
	// providers bill by. The cost pipeline prices audio spans from these.
	AttrGenAIUsageInputChars   = "gen_ai.usage.input_chars"
	AttrGenAIUsageAudioSeconds = "gen_ai.usage.audio_seconds"

	// AttrLabels carries the VK's tags; the trace pipeline ingests this
	// exact key into metadata.labels (otel.traces.ts), which the Trace
	// Explorer filters as "Label".
	AttrLabels = "langwatch.labels"
)
