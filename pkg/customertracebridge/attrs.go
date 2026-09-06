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
	// dispatched to. The control plane's fold allowlists this exact key
	// (trace-attribute-accumulation.service.ts) so usage views can break
	// spend down by vendor. The same id travels on the spend commands as
	// `model_provider_id`, which is what decides the provider-filtered
	// budgets a debit belongs to; a dispatch without it debits unfiltered
	// budgets only.
	AttrModelProviderID       = "langwatch.model_provider_id"
	AttrGenAIUsageIn          = "gen_ai.usage.input_tokens"
	AttrGenAIUsageCacheRead   = "gen_ai.usage.cache_read.input_tokens"
	AttrGenAIUsageCacheCreate = "gen_ai.usage.cache_creation.input_tokens"
	// The portion of the writes above that bought an hour-long cache entry,
	// billed above the short-lived rate. Absent when the provider did not say.
	AttrGenAIUsageCacheCreate1h = "gen_ai.usage.cache_creation_1h.input_tokens"
	AttrGenAIConversationID     = "gen_ai.conversation.id"

	// Audio usage measures (no upstream semconv exists yet for either):
	// characters synthesized by a TTS call and seconds of audio transcribed
	// by an STT call, the units character- and duration-priced audio
	// providers bill by. The cost pipeline prices audio spans from these.
	AttrGenAIUsageInputChars   = "gen_ai.usage.input_chars"
	AttrGenAIUsageAudioSeconds = "gen_ai.usage.audio_seconds"

	// Audio token counts, which audio-native models bill several times above
	// text: OpenAI charges $32 per million audio input tokens against $4 for
	// text on gpt-realtime. Both are DISJOINT from gen_ai.usage.input_tokens
	// and gen_ai.usage.output_tokens, the same exclusive convention the cache
	// buckets above use, so the cost pipeline prices each token once and a
	// trace costs what the budget was charged.
	AttrGenAIUsageInputAudioTokens  = "gen_ai.usage.input_audio_tokens"
	AttrGenAIUsageOutputAudioTokens = "gen_ai.usage.output_audio_tokens"

	// Image token counts and the number of images returned, on the same
	// exclusive convention as the audio buckets above: an output image token
	// on the gpt-image family costs four times a text one, and some vendors
	// price the call per image instead of per token.
	AttrGenAIUsageInputImageTokens  = "gen_ai.usage.input_image_tokens"
	AttrGenAIUsageOutputImageTokens = "gen_ai.usage.output_image_tokens"
	AttrGenAIUsageImageCount        = "gen_ai.usage.image_count"

	// AttrLabels carries the VK's tags; the trace pipeline ingests this
	// exact key into metadata.labels (otel.traces.ts), which the Trace
	// Explorer filters as "Label".
	AttrLabels = "langwatch.labels"

	// AttrEndUserID is the caller's external end-user id (their customer's
	// user, not a LangWatch principal), resolved from the
	// x-langwatch-end-user-id header, its x-litellm-end-user-id migration
	// alias, or the OpenAI `user` body param, in that order. The trace fold
	// copies it into per-request spend events and the attributed-user
	// budget buckets key on it.
	AttrEndUserID = "langwatch.end_user_id"

	// AttrRequestMetadata is the caller's x-langwatch-metadata echo: a raw
	// JSON object (4KB cap, validated at the edge) round-tripped verbatim
	// into billing spend events so the caller's billing system can join
	// events back to its own entities without a lookup.
	AttrRequestMetadata = "langwatch.reserved.request_metadata"

	// AttrRequestedModel is the model name the client sent, present only when
	// a routing policy rewrote it. gen_ai.request.model carries the model that
	// was dispatched, so without this the caller's own vocabulary is not in
	// the trace at all: a policy that points the "complex" tier somewhere new
	// would silently change what every trace says the caller asked for, and
	// "who still sends gpt-4o" becomes unanswerable.
	AttrRequestedModel = "langwatch.requested_model"
)
