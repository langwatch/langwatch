// Package memory holds in-memory twins of the evaluators module's channels
// for tests. A twin answers only what a test scripted and fails by name on
// anything else.
package memory

import (
	"context"
	"errors"
	"sync"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
)

// LLM is the LLMChannel twin. It records every request it receives.
type LLM struct {
	mu          sync.Mutex
	complete    func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error)
	embed       func(context.Context, channels.EmbeddingRequest) (channels.EmbeddingResponse, error)
	completions []channels.CompletionRequest
	embeddings  []channels.EmbeddingRequest
}

var _ channels.LLMChannel = (*LLM)(nil)

// NewLLM returns a twin with nothing scripted.
func NewLLM() *LLM { return &LLM{} }

// ScriptComplete sets how Complete answers.
func (l *LLM) ScriptComplete(fn func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error)) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.complete = fn
}

// ScriptEmbed sets how Embed answers.
func (l *LLM) ScriptEmbed(fn func(context.Context, channels.EmbeddingRequest) (channels.EmbeddingResponse, error)) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.embed = fn
}

// Complete records the request and answers from the script.
func (l *LLM) Complete(ctx context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
	l.mu.Lock()
	l.completions = append(l.completions, req)
	fn := l.complete
	l.mu.Unlock()
	if fn == nil {
		return channels.CompletionResponse{}, errors.New("memory.LLM: Complete is not scripted")
	}
	return fn(ctx, req)
}

// Embed records the request and answers from the script.
func (l *LLM) Embed(ctx context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
	l.mu.Lock()
	l.embeddings = append(l.embeddings, req)
	fn := l.embed
	l.mu.Unlock()
	if fn == nil {
		return channels.EmbeddingResponse{}, errors.New("memory.LLM: Embed is not scripted")
	}
	return fn(ctx, req)
}

// Completions returns a copy of every Complete request so far.
func (l *LLM) Completions() []channels.CompletionRequest {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]channels.CompletionRequest(nil), l.completions...)
}

// Embeddings returns a copy of every Embed request so far.
func (l *LLM) Embeddings() []channels.EmbeddingRequest {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]channels.EmbeddingRequest(nil), l.embeddings...)
}
