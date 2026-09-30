package rules

import (
	tiktoken "github.com/pkoukk/tiktoken-go"
	tiktokenloader "github.com/pkoukk/tiktoken-go-loader"
)

// TokenCounter is litellm.encode's count: cl100k_base for every model. litellm
// switches to Hugging Face tokenizers for llama and command-r only; Go counts
// those with cl100k too (plan §8.2). Build one and share it; it is read-only.
type TokenCounter struct {
	encoding *tiktoken.Tiktoken
}

// NewTokenCounter loads cl100k_base from the embedded ranks, with no network.
func NewTokenCounter() (*TokenCounter, error) {
	tiktoken.SetBpeLoader(tiktokenloader.NewOfflineLoader())
	encoding, err := tiktoken.GetEncoding(tiktoken.MODEL_CL100K_BASE)
	if err != nil {
		return nil, err
	}
	return &TokenCounter{encoding: encoding}, nil
}

// Count is the number of tokens text takes; model is kept for litellm's signature.
func (c *TokenCounter) Count(_ string, text string) int {
	return len(c.encoding.Encode(text, nil, nil))
}
