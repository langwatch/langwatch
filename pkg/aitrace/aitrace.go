// Package aitrace holds the vocabulary of one AI gateway call that the
// customer trace bridge turns into a span: provider, request type, usage and
// the trace parameters. services/aigateway/domain aliases these types.
package aitrace

// ProviderID identifies a model provider (e.g. "openai", "anthropic", "azure").
type ProviderID string

// The providers the gateway routes to, by the identifier stored on a credential.
const (
	ProviderOpenAI    ProviderID = "openai"
	ProviderAnthropic ProviderID = "anthropic"
	ProviderAzure     ProviderID = "azure"
	ProviderBedrock   ProviderID = "bedrock"
	ProviderVertex    ProviderID = "vertex"
	ProviderGemini    ProviderID = "gemini"
	// ProviderXAI, ProviderGroq and ProviderCerebras are Bifrost-native providers routed with a
	// plain API key (see mapProvider / credentialToBifrostKey defaults).
	ProviderXAI      ProviderID = "xai"
	ProviderGroq     ProviderID = "groq"
	ProviderCerebras ProviderID = "cerebras"
	// ProviderDeepSeek is not in Bifrost's ModelProvider enum. Its API is
	// OpenAI-compatible, so the gateway routes it through Bifrost's vLLM
	// (openai-compat) provider with DeepSeek's public endpoint as the
	// default base URL.
	ProviderDeepSeek ProviderID = "deepseek"
	// ProviderVoyage is direct-API only. Bifrost has no Voyage ModelProvider
	// enum; the gateway proxies Voyage embeddings via a thin direct
	// HTTP path. Voyage's wire format is OpenAI-compatible so no body
	// translation is needed. Voyage ships embeddings only; chat,
	// messages, and responses calls against a Voyage credential land
	// on a clean unsupported-request-type error.
	ProviderVoyage ProviderID = "voyage"
	// ProviderCustom is any OpenAI-compatible endpoint the customer hosts
	// themselves (vLLM, LiteLLM proxy, ...). Requires a base URL; the
	// API key is optional (many self-hosted servers run unauthenticated).
	ProviderCustom ProviderID = "custom"
	// ProviderElevenLabs is a Bifrost-native provider (enum value "elevenlabs",
	// plain API key). It ships speech (TTS) and transcription (STT) only;
	// chat-family calls against an ElevenLabs credential surface the
	// provider's reject directly, same policy as Anthropic embeddings.
	ProviderElevenLabs ProviderID = "elevenlabs"
	// ProviderLangWatch is another LangWatch gateway reached as an upstream
	// provider: a connected self-hosted install forwarding OpenAI-compatible
	// calls to LangWatch-managed models with its license token as the
	// credential. Both sides speak the same wire, so the gateway proxies
	// directly (no Bifrost enum). See adapters/providers/langwatch.go and
	// ADR-139 section 8.
	ProviderLangWatch ProviderID = "langwatch"
	// ProviderOpenAICodex is the user's own ChatGPT subscription, reached through
	// OpenAI's codex backend (chatgpt.com/backend-api/codex) with an OAuth
	// access token instead of an API key. Responses-API + SSE only; the
	// gateway proxies directly (no Bifrost enum) and refreshes a 401'd
	// token once via the control plane. See adapters/providers/codex.go.
	ProviderOpenAICodex ProviderID = "openai_codex"
)

// RequestType classifies the inbound endpoint.
type RequestType string

// The inbound endpoints the gateway serves, one per request shape.
const (
	RequestTypeChat       RequestType = "chat"
	RequestTypeMessages   RequestType = "messages"
	RequestTypeEmbeddings RequestType = "embeddings"
	RequestTypeResponses  RequestType = "responses"
	// RequestTypePassthrough routes the body verbatim to the provider's
	// native HTTP endpoint. Used for Gemini-native /v1beta paths where
	// the inbound shape (Google GenAI SDK, gemini-cli) doesn't match any
	// of the OpenAI/Anthropic-family schemas Bifrost exposes through its
	// typed entry points.
	RequestTypePassthrough RequestType = "passthrough"
	// RequestTypeSpeech is POST /v1/audio/speech (OpenAI-wire TTS). The
	// response body is binary audio, not JSON.
	RequestTypeSpeech RequestType = "speech"
	// RequestTypeTranscription is POST /v1/audio/transcriptions
	// (OpenAI-wire multipart STT).
	RequestTypeTranscription RequestType = "transcription"
	// RequestTypeImageGeneration is POST /v1/images/generations
	// (OpenAI-wire image generation). Non-streaming only.
	RequestTypeImageGeneration RequestType = "image_generation"
	// RequestTypeImageEdit is POST /v1/images/edits (OpenAI-wire multipart
	// image edit). Non-streaming only.
	RequestTypeImageEdit RequestType = "image_edit"
	// RequestTypeRealtimeSession mints a vendor session credential for a
	// realtime voice socket the gateway does not carry (ADR-097). Its spend
	// record is admitted here and closed later, by the vendor's own report.
	RequestTypeRealtimeSession RequestType = "realtime_session"
)

// AITraceParams holds data for a customer AI trace.
type AITraceParams struct {
	ProjectID  string
	Model      string
	ProviderID ProviderID
	// InternalModel and InternalProviderID are safe to copy to LangWatch's
	// operational span because they came from manager-owned gateway config.
	// Model and ProviderID above remain customer-trace fields: callers can
	// control them when a virtual key permits arbitrary model names.
	InternalModel      string
	InternalProviderID ProviderID
	Usage              Usage
	RequestType        RequestType

	// RequestedModel is the model name the client sent, when a routing policy
	// rewrote it into Model. Empty when the caller got what they asked for.
	// Customer-controlled, like Model, so it stays off the internal span.
	RequestedModel string

	// VirtualKeyID is the id of the VK that authorized this request. Stamped
	// on the customer span so the control plane's trace-processing pipeline
	// can fold per-budget spend back into ClickHouse idempotently.
	VirtualKeyID string

	// GatewayRequestID is the per-request ULID issued by the gateway. Acts as
	// the idempotency key for the CH-fold debit row; replays collapse on the
	// ReplacingMergeTree's (TenantId, BudgetId, GatewayRequestId) ORDER BY.
	GatewayRequestID string

	// ModelProviderID is the ModelProvider row id of the provider the request
	// was actually dispatched to (the credential that served it, or the last
	// one tried when every attempt failed). Stamped on the customer span as
	// langwatch.model_provider_id so the control plane's trace fold can debit
	// provider-filtered budgets; without it those budgets never accrue.
	// Empty when nothing was dispatched, in which case the fold debits
	// unfiltered budgets only. Contract §4.5.
	ModelProviderID string

	// VKTags are the VK's operator-assigned tags, stamped on the customer
	// span as langwatch.labels so the trace pipeline ingests them into
	// metadata.labels — the field the Trace Explorer filters as "Label".
	VKTags []string

	// RequestBody and ResponseBody are the raw JSON bodies for input/output
	// extraction. Either may be nil (e.g. streaming responses).
	RequestBody  []byte
	ResponseBody []byte

	// UpstreamStatusCode is the provider's terminal HTTP status when the
	// request failed upstream (0 on success). Stamped on the customer span so
	// the trace surfaces the failure instead of being silently dropped.
	UpstreamStatusCode int

	// UpstreamErrorType is a short error-class token (e.g. provider_timeout,
	// bad_request) recorded as the span's error.type when the request failed.
	UpstreamErrorType string

	// MirrorTier is the ADR-061 mirror fidelity resolved for this VK's
	// organization ("content" | "structural" | "skip" | ""), materialized into
	// the bundle by the control plane. Non-skip only for Langy virtual keys, so
	// ordinary customer traffic is never mirrored. content ⇒ the gateway emits a
	// SECOND gen_ai span (with prompt/completion) into the mirror project;
	// structural ⇒ the same span with content stripped; skip/"" ⇒ nothing.
	MirrorTier string
	// MirrorSourceOrgID is the customer organization the mirrored call belongs
	// to, stamped on the mirror copy for per-customer attribution (ADR-061 §5).
	MirrorSourceOrgID string
}
