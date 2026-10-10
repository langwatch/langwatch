package domain

import (
	"context"
	"time"
)

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

	// RealtimeConversationID is the vendor's own id for the conversation a
	// session mint just opened, when the mint call reports one. It is the
	// join key the vendor's post-call report arrives under, and it is known
	// before the socket exists, which is what makes the match exact instead
	// of a guess over open sessions. Empty on every other lane.
	RealtimeConversationID string

	// RealtimeCredentialExpiresAt is when the credential a session mint
	// returned stops opening a socket, when the vendor states it. Zero on
	// every other lane.
	RealtimeCredentialExpiresAt time.Time

	// VoiceRelay is set when the request booked a relayed voice socket. The
	// HTTP layer dials the vendor and relays with it. Nil on every other lane.
	VoiceRelay *VoiceRelayTicket
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
