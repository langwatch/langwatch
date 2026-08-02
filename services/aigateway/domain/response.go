package domain

import "context"

// Response is the provider-agnostic representation of a completed API response.
type Response struct {
	// Body is the raw response bytes (provider-specific format).
	Body []byte

	// StatusCode from the upstream provider.
	StatusCode int

	// Usage is the token/cost information extracted from the response.
	Usage Usage

	// Headers to forward to the client.
	Headers map[string]string
}

// Usage holds token counts and cost information.
//
// PromptTokens is the provider's full prompt total and INCLUDES any cached
// tokens (Bifrost sums cache reads/writes into it). CacheReadTokens and
// CacheCreationTokens carry the cache breakdown so the span can report the
// fresh, non-cached input separately and the cost can price each bucket once.
type Usage struct {
	PromptTokens        int
	CompletionTokens    int
	TotalTokens         int
	CacheReadTokens     int // tokens read from the prompt cache (priced at the cache-read rate)
	CacheCreationTokens int // tokens written to the prompt cache (priced at the cache-write rate)
	// CacheCreation1hTokens is the portion of CacheCreationTokens that bought
	// an hour-long cache entry rather than a five-minute one. Anthropic bills
	// the hour at twice the input rate against the five minutes' 1.25x, so a
	// write priced without this comes out about a third under the bill. Only
	// the Anthropic-native lanes can report it: the provider states the split
	// in its own response body, and the normalized usage struct every other
	// lane goes through has one flat cache-write count. Zero means unknown,
	// and the whole write prices short-lived, exactly as before.
	CacheCreation1hTokens int
	CostMicroUSD          int64  // cost in microdollars (1/1_000_000 USD)
	Model                 string // resolved model name from the request

	// Audio measures. TTS is priced by input characters and STT by audio
	// duration on providers that do not report token usage (ElevenLabs,
	// whisper-1); providers that DO report tokens (gpt-4o-mini-tts,
	// gpt-4o-transcribe) fill the token fields above as usual. Zero when
	// not applicable.
	InputChars   int     // TTS: characters synthesized
	AudioSeconds float64 // STT: seconds of audio transcribed
}

// StreamIterator provides pull-based iteration over streaming response chunks.
type StreamIterator interface {
	// Next advances to the next chunk. Returns false when done or on error.
	// The context allows cancellation and is threaded through for policy evaluation.
	Next(ctx context.Context) bool

	// Chunk returns the current raw chunk bytes (SSE data line content).
	Chunk() []byte

	// Usage returns accumulated usage (populated on final chunk if available).
	Usage() Usage

	// Err returns any error that terminated the stream.
	Err() error

	// Close releases resources.
	Close() error
}

// RawFramer is an optional StreamIterator extension: when implemented and
// RawFraming() returns true, Chunk() already contains fully-formed SSE
// frames (event/data lines with their own framing). Writers should
// forward chunks verbatim rather than wrapping them in another
// `data: ... \n\n` envelope. Used by the Gemini-native passthrough path
// where upstream (streamGenerateContent) emits proper SSE bytes.
type RawFramer interface {
	RawFraming() bool
}
