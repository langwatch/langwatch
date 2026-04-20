package domain

// Request is the provider-agnostic representation of an inbound API request.
type Request struct {
	// Type distinguishes the endpoint shape.
	Type RequestType

	// Model is the raw model string from the request body.
	Model string

	// Resolved is populated after model resolution.
	Resolved *ResolvedModel

	// Body is the raw request body bytes (provider-specific format).
	// Providers parse this according to their wire format.
	Body []byte

	// Streaming indicates the client requested a streaming response.
	Streaming bool

	// Metadata carries provider-agnostic extracted data for policy evaluation
	// (tool names, MCP identifiers, system instructions, etc.).
	Metadata RequestMetadata
}

// RequestType classifies the inbound endpoint.
type RequestType string

const (
	RequestTypeChat       RequestType = "chat"
	RequestTypeMessages   RequestType = "messages"
	RequestTypeEmbeddings RequestType = "embeddings"
)

// RequestMetadata holds extracted fields for policy evaluation (guardrails, blocked patterns).
type RequestMetadata struct {
	ToolNames          []string
	MCPIdentifiers     []string
	SystemInstructions string
}
