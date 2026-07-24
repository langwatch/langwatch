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
)

// RequestMetadata holds extracted fields for policy evaluation (guardrails, blocked patterns).
type RequestMetadata struct {
	ToolNames          []string
	MCPIdentifiers     []string
	SystemInstructions string
}
