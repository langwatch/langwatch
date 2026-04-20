package ksuid

// Resource constants for ID generation. Resources must not contain underscores
// since underscore is the delimiter in the serialized format (env_resource_encoded).
//
// Format: prod_gtwyreq_00<base62> or staging_gtwyreq_00<base62>
const (
	ResourceGatewayRequest     = "gtwyreq"       // HTTP request hitting the AI gateway
	ResourceGatewayTrace       = "gtwytrace"     // gateway operational OTel trace
	ResourceAICompletionTrace  = "aicomptrace"   // customer-facing AI completion trace span
	ResourceBudgetDebit        = "budgetdebit"   // budget spend debit event in outbox
	ResourceAuthCacheEntry     = "authcache"     // resolved VK auth bundle cache entry
)
