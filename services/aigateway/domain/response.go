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

	// Audio token counts, for the realtime and audio-native models that
	// bill audio far above text: OpenAI charges $32 per million audio input
	// tokens against $4 for text input on gpt-realtime, so a flat prompt
	// total prices an audio turn at a fraction of what it costs. Both counts
	// are DISJOINT from PromptTokens and CompletionTokens, which is what
	// SplitAudioTokens keeps true, so every consumer prices each bucket
	// exactly once.
	InputAudioTokens  int
	OutputAudioTokens int

	// ReasoningTokens is the portion of CompletionTokens the model spent
	// thinking. The provider already bills those tokens inside the
	// completion total, so this count is reported and never priced.
	ReasoningTokens int
}

// AudioTokenSplit is one provider's audio/text token breakdown, as reported
// on the response. Text counts are zero when the provider states only the
// audio side.
type AudioTokenSplit struct {
	InputAudio  int
	InputText   int
	OutputAudio int
	OutputText  int
}

// SplitAudioTokens records the audio token counts and takes them out of the
// prompt and completion totals.
//
// Providers report audio tokens INSIDE those totals. Pricing the totals at
// the text rate and the audio counts at the audio rate on top charges the
// audio portion twice, at rates that differ by 8x, so the counts have to be
// made disjoint before anything prices them. The provider's own text count
// wins when it reports one; otherwise the audio count comes off the total.
//
// A pair that does not add up leaves the totals alone. A negative remainder
// means the provider's own numbers disagree, and an unsplit total charges
// the audio at the text rate, which is the behavior every caller had
// before this split existed.
func (u Usage) SplitAudioTokens(split AudioTokenSplit) Usage {
	u.InputAudioTokens, u.PromptTokens = resolveAudioSplit(
		split.InputAudio, split.InputText, u.PromptTokens)
	u.OutputAudioTokens, u.CompletionTokens = resolveAudioSplit(
		split.OutputAudio, split.OutputText, u.CompletionTokens)
	return u
}

// resolveAudioSplit answers one side of the split: the audio count to keep
// and the text total that is left once the audio is out of it.
func resolveAudioSplit(audio, text, total int) (int, int) {
	if audio <= 0 {
		return 0, total
	}
	if text > 0 {
		return audio, text
	}
	if remainder := total - audio; remainder >= 0 {
		return audio, remainder
	}
	return 0, total
}

// ReconcileCacheWrites raises CacheCreationTokens to at least
// CacheCreation1hTokens, restoring the rule that the hour-long count is a
// portion of the write total.
//
// The two can arrive from different sources. On the raw-forward lanes the
// total comes from the normalized usage struct while the split is read off
// the provider's own bytes, and the normalized struct reports no writes at
// all there. An unreconciled pair bills those tokens twice: once inside
// gen_ai.usage.input_tokens, because the emitter derives fresh input by
// subtracting the write total, and again as an hour-long write at twice the
// input rate. Every producer that sets CacheCreation1hTokens calls this
// before handing the usage on.
func (u Usage) ReconcileCacheWrites() Usage {
	if u.CacheCreation1hTokens > u.CacheCreationTokens {
		u.CacheCreationTokens = u.CacheCreation1hTokens
	}
	return u
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
