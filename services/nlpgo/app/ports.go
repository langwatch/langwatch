// Package app is the nlpgo application layer. It wires the engine,
// child-process manager, and gateway client together. All external
// dependencies are accessed through interfaces declared here so the
// app stays testable without real upstreams.
package app

import (
	"context"
	"io"
	"net/http"
	"time"
)

// GatewayClient is the typed client over the LangWatch AI Gateway. Owned
// by @ash in adapters/gatewayclient/. Bodies are passed pre-serialized;
// the gateway is HTTP-only (see _shared/contract.md §8).
type GatewayClient interface {
	ChatCompletions(ctx context.Context, req GatewayRequest) (*GatewayResponse, error)
	ChatCompletionsStream(ctx context.Context, req GatewayRequest) (StreamIterator, error)
	Messages(ctx context.Context, req GatewayRequest) (*GatewayResponse, error)
	MessagesStream(ctx context.Context, req GatewayRequest) (StreamIterator, error)
	Responses(ctx context.Context, req GatewayRequest) (*GatewayResponse, error)
	ResponsesStream(ctx context.Context, req GatewayRequest) (StreamIterator, error)
	Embeddings(ctx context.Context, req GatewayRequest) (*GatewayResponse, error)
}

// GatewayRequest is the wire-level shape sent to the gateway. Headers
// include the per-call X-LangWatch-* metadata; Body is pre-serialized
// JSON so the gateway client doesn't re-encode.
type GatewayRequest struct {
	Body    []byte
	Headers map[string]string
	Model   string
	Project string
}

// GatewayResponse is the gateway's reply. Body is verbatim upstream
// bytes; Meta carries the X-LangWatch-* headers we want to forward
// back to the caller (request id, fallback count, cache mode).
type GatewayResponse struct {
	StatusCode int
	Body       []byte
	Headers    map[string]string
}

// StreamIterator is the gateway streaming-response shape. Mirrors
// services/aigateway/domain.StreamIterator on purpose so the proxy
// passthrough adapter (adapters/proxypass) can reuse the same wire
// format without re-framing.
type StreamIterator interface {
	Next(ctx context.Context) bool
	Chunk() []byte
	Err() error
	Close() error
}

// LLMClient executes a Signature (LLM) node against the gateway. It
// owns the shape mapping from a node's `litellm_params` to the gateway
// wire format (see _shared/contract.md §9). Owned by @ash in
// adapters/llmexecutor/.
type LLMClient interface {
	Execute(ctx context.Context, req LLMRequest) (*LLMResponse, error)
	ExecuteStream(ctx context.Context, req LLMRequest) (StreamIterator, error)
}

// LLMRequest is the engine's view of an LLM call. The translator (Ash)
// maps Provider+Params into the right gateway endpoint. Stream is
// determined by the caller.
type LLMRequest struct {
	Model           string
	Provider        string
	Messages        []ChatMessage
	Tools           []Tool
	Temperature     *float64
	MaxTokens       *int
	TopP            *float64
	ReasoningEffort string
	ResponseFormat  *ResponseFormat
	LiteLLMParams   map[string]any
	Headers         map[string]string
	ProjectID       string
}

// LLMResponse is the engine's view of an LLM reply. Cost and Duration
// are first-class so we don't need DSPy-style class mutation to track
// them.
type LLMResponse struct {
	Content    string
	Messages   []ChatMessage
	ToolCalls  []ToolCall
	Cost       float64
	DurationMS int64
	Usage      Usage
	Raw        []byte
}

// ChatMessage mirrors the OpenAI chat shape. content can be a plain
// string or a list of content parts (text + image url). We keep it as
// an opaque any to avoid forcing a sum type before the engine needs it.
type ChatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content,omitempty"`
	// ReasoningContent is the model's reasoning trace returned alongside
	// the final answer for reasoning models (DeepSeek's `reasoning_content`,
	// OpenAI's o1/o3/gpt-5 internal reasoning surfaced via gateway, plus
	// Anthropic's thinking blocks). Mirrors langwatch_nlp commit
	// 16f1d4a80 ("add reasoning tokens and effort support for LLM
	// models"), the message half of the parity claim — usage.reasoning_tokens
	// already round-trips via Usage.ReasoningTokens.
	ReasoningContent string         `json:"reasoning_content,omitempty"`
	Name             string         `json:"name,omitempty"`
	ToolCalls        []ToolCall     `json:"tool_calls,omitempty"`
	ToolCallID       string         `json:"tool_call_id,omitempty"`
	Extra            map[string]any `json:"-"`
}

// Tool, ToolCall, ResponseFormat, Usage shadow the OpenAI shapes. The
// engine doesn't interpret them — they pass through to the gateway as-is.
type Tool struct {
	Type     string         `json:"type"`
	Function map[string]any `json:"function,omitempty"`
}

type ToolCall struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Function map[string]any `json:"function"`
}

type ResponseFormat struct {
	Type       string         `json:"type"`
	JSONSchema map[string]any `json:"json_schema,omitempty"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	ReasoningTokens  int `json:"reasoning_tokens,omitempty"`
}

// CodeRunner executes a single code-block invocation in an isolated
// subprocess. Owned by @sarah in adapters/codesandbox/. The Go engine
// builds the request from the workflow node's declared inputs and the
// upstream node outputs.
type CodeRunner interface {
	Run(ctx context.Context, req CodeRequest) (*CodeResult, error)
}

// CodeRequest is what the engine hands to the code sandbox per call.
// Timeout is enforced by the runner, not by the engine, so the runner
// can guarantee `kill -9` on overrun.
type CodeRequest struct {
	Code    string
	Inputs  map[string]any
	Outputs []string
	Timeout time.Duration
	TraceID string
}

// CodeResult is what the runner returns. Stdout/Stderr are captured
// for the per-node execution event. Outputs is the JSON-decoded result
// keyed by the node's declared output names.
type CodeResult struct {
	Outputs    map[string]any
	Stdout     string
	Stderr     string
	DurationMS int64
	TimedOut   bool
	Error      *CodeError
}

// CodeError carries a structured Python exception when user code
// raises. Type is the Python exception class name; Traceback is the
// formatted traceback string surfaced in the SSE event.
type CodeError struct {
	Type      string
	Message   string
	Traceback string
}

// ChildHealth probes the uvicorn child for readiness. Used by the
// /healthz aggregation in serve.go.
type ChildHealth interface {
	Healthy(ctx context.Context) error
}

// ChildProxy reverse-proxies any unmatched (non-/go/*) request to the
// uvicorn child process. Implemented by adapters/proxypass.
type ChildProxy interface {
	http.Handler
}

// ChildManager owns the lifecycle of the uvicorn child process.
// Implemented by adapters/uvicornchild.
type ChildManager interface {
	Start(ctx context.Context) error
	Stop()
	Healthy(ctx context.Context) error
	// Fatal returns a channel that emits when the child exits unexpectedly,
	// so the lifecycle group can tear nlpgo down with the same exit code.
	Fatal() <-chan error
}

// SecretsResolver resolves a secret reference like {{ secrets.NAME }} at
// HTTP-block invocation time. Owned by Sarah; backed by a cached fetch
// from the control plane.
type SecretsResolver interface {
	Resolve(ctx context.Context, projectID, name string) (string, error)
}

// IsCloseable is a helper for adapters that need to close on shutdown.
type IsCloseable interface {
	io.Closer
}
