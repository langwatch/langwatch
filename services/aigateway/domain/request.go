package domain

import "io"

// Request is the provider-agnostic representation of an inbound API request.
type Request struct {
	// Type distinguishes the endpoint shape.
	Type RequestType

	// Model is the raw model string from the request body.
	Model string

	// Resolved is populated after model resolution.
	Resolved *ResolvedModel

	// Body is the materialized request body bytes. If nil, call MaterializeBody()
	// to read from BodyReader.
	Body []byte

	// BodyReader is the original request stream (or MultiReader with peeked bytes).
	BodyReader io.Reader

	// Metadata carries provider-agnostic extracted data for policy evaluation
	// (tool names, MCP identifiers, system instructions, etc.).
	Metadata RequestMetadata

	// Passthrough carries the raw HTTP context for RequestTypePassthrough
	// (provider-native paths like Gemini /v1beta/models/{m}:generateContent).
	// Zero for all other request types.
	Passthrough PassthroughRequest

	// Transcription carries the parsed multipart upload for
	// RequestTypeTranscription. The router parses the form (the only place
	// with access to the HTTP request) so the rest of the pipeline works on
	// materialized bytes like every other request type. Nil otherwise.
	Transcription *TranscriptionUpload

	// RealtimeSession carries the mint parameters for
	// RequestTypeRealtimeSession. Nil otherwise.
	RealtimeSession *RealtimeSessionRequest

	// Surface is the route this request arrived on, stated by the handler
	// registered there, when that route can only be served by named
	// providers. Zero on the routes the gateway translates, which any
	// provider can serve.
	Surface Surface
}

// InboundSurface reports the route this request arrived on when that route
// pins its own providers, and the zero Surface when it does not. The routes
// that pin are the ones whose wire the gateway does not translate: the
// raw-forward passthrough, and the realtime session mints.
func (r *Request) InboundSurface() Surface {
	if r == nil {
		return Surface{}
	}
	return r.Surface
}

// ModelBodyPath is where the model id sits in this request's JSON body, in
// sjson path syntax. The realtime mint nests it under the session object the
// vendor reads; every other shape uses the top-level field.
func (r *Request) ModelBodyPath() string {
	if r != nil && r.Type == RequestTypeRealtimeSession {
		return "session.model"
	}
	return "model"
}

// TranscriptionUpload is the normalized content of a /v1/audio/transcriptions
// multipart form: the audio file plus the OpenAI-wire optional parameters.
type TranscriptionUpload struct {
	File     []byte
	Filename string
	// Params holds the optional string form fields exactly as received
	// (language, prompt, response_format, temperature). The dispatcher maps
	// them onto the provider request; unknown fields are dropped by the
	// router rather than forwarded blind.
	Params map[string]string
}

// PassthroughRequest captures HTTP-level fields a raw-forward route needs
// to reconstruct the upstream call. Populated by the router handler for
// RequestTypePassthrough; ignored otherwise.
type PassthroughRequest struct {
	Method   string            // HTTP method (typically POST)
	Path     string            // Provider-relative path (e.g. "/models/gemini-2.5-flash:generateContent")
	RawQuery string            // Query string without leading "?"
	Headers  map[string]string // Forwarded client headers (auth already stripped)
	Stream   bool              // True when the path resolves to a streaming endpoint
}

// Surface is an inbound route the gateway does not translate, and the
// providers that can answer it. The body and the URL path reach the vendor
// as the caller wrote them on such a route, so the route decides the vendor,
// not the model name in it.
//
// Translated routes carry no Surface. Most of what is under /v1 is rewritten
// per provider before it leaves, so any provider can serve those and the
// model resolver picks.
type Surface struct {
	// Name is the route as the caller wrote it, for use in a refusal.
	Name string
	// Providers can serve this route's wire format. Order is not priority:
	// the credential chain keeps its own order.
	Providers []ProviderID
}

// GeminiSurface is the /v1beta route: Google's generative-language wire,
// used by gemini-cli and the @google/genai SDK.
//
// Vertex is on the list with Gemini because the same request reaches Google
// through either. Bifrost's Vertex passthrough rewrites an inbound Google
// path into the project-and-location form, so a caller who sends the Vertex
// path shape to /v1beta is served by a Vertex credential. No provider
// outside these two serves this wire, so no other credential may receive
// the body.
func GeminiSurface() Surface {
	return Surface{Name: "/v1beta", Providers: []ProviderID{ProviderGemini, ProviderVertex}}
}

// RequestType classifies the inbound endpoint.
type RequestType string

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
	// RequestTypeRealtimeSession mints a vendor session credential for a
	// realtime voice socket the gateway does not carry (ADR-097). Its spend
	// record is admitted here and closed later, by the vendor's own report.
	RequestTypeRealtimeSession RequestType = "realtime_session"
)

// RequestMetadata holds extracted fields for policy evaluation (guardrails, blocked patterns).
type RequestMetadata struct {
	ToolNames          []string
	MCPIdentifiers     []string
	SystemInstructions string
}
