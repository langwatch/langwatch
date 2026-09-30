// Package channels declares the messages the evaluators module sends to things
// it does not own. Interfaces live here; implementations in one subpackage per
// tier (gateway/, http/, memory/). Plan: §3.1.
package channels

import (
	"context"
	"encoding/json"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// LLMChannel calls models with the tenant's own credentials, per call.
type LLMChannel interface {
	Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
	Embed(ctx context.Context, req EmbeddingRequest) (EmbeddingResponse, error)
}

// Message is one chat message. Content is a string or OpenAI content parts.
type Message struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

// CompletionRequest is an OpenAI-shaped chat call. Credentials come from
// Tenant.Env's X_LITELLM_* params only.
type CompletionRequest struct {
	Tenant          contract.Tenant
	Model           string
	Messages        []Message
	Tools           []json.RawMessage
	ToolChoice      json.RawMessage
	Temperature     *float64
	MaxTokens       *int
	N               int
	ReasoningEffort string
}

// ToolCall is a function call the model made.
type ToolCall struct {
	Name      string
	Arguments string
}

// Choice is one completion.
type Choice struct {
	Content      string
	ToolCalls    []ToolCall
	FinishReason string
}

// Usage is what the call consumed.
type Usage struct {
	PromptTokens     int
	CompletionTokens int
}

// CompletionResponse carries the raw bodies so the customer trace records them.
type CompletionResponse struct {
	Choices      []Choice
	Usage        Usage
	CostUSD      *float64 // nil when the model has no known price
	RequestBody  []byte
	ResponseBody []byte
}

// EmbeddingRequest embeds texts with Tenant.Env's X_LITELLM_EMBEDDINGS_* params.
type EmbeddingRequest struct {
	Tenant contract.Tenant
	Model  string
	Inputs []string
}

// EmbeddingResponse holds one vector per input, in order.
type EmbeddingResponse struct {
	Vectors [][]float64
	Usage   Usage
	CostUSD *float64
}
