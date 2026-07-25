package customertracebridge

// Attribute keys stamped on customer-facing trace data. Single source for
// both this package (customer-bound spans) and the gateway's own operational
// tracer (gatewaytracer imports these for its scalar-only internal copies).
// The origin KEY lives in pkg/otelsetup (AttrLangWatchOrigin); origin VALUES
// are service identity and are declared by each service, in its own Policy.
const (
	AttrVirtualKeyID          = "langwatch.virtual_key_id"
	AttrGatewayReqID          = "langwatch.gateway_request_id"
	AttrGenAIUsageIn          = "gen_ai.usage.input_tokens"
	AttrGenAIUsageCacheRead   = "gen_ai.usage.cache_read.input_tokens"
	AttrGenAIUsageCacheCreate = "gen_ai.usage.cache_creation.input_tokens"
	AttrGenAIConversationID   = "gen_ai.conversation.id"
)
