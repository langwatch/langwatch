package domain

import "context"

// RealtimeBrokerRelay is a vendor WebSocket the gateway relays frame by
// frame, for clients on the WebSocket transport. The vendor socket needs the
// provider key, so it is dialed here and never by the client.
const RealtimeBrokerRelay RealtimeBroker = "relay"

// Close codes the relay sends a client, beside the ones it passes on.
const (
	// RelayClosePolicy closes on an exhausted budget or a revoked key.
	RelayClosePolicy = 1008
	// RelayCloseRestart closes on a deploy: the client dials again.
	RelayCloseRestart = 1012
)

// VoiceRelayTicket is a relayed session that was admitted and booked and has
// no vendor socket yet. Whoever holds it either relays it or releases it.
type VoiceRelayTicket struct {
	// Session is what the supervisor meters and ends the call by.
	Session BrokeredVoiceSession
	// Slot is the supervision place taken for the call.
	Slot VoiceSlot
	// Model is the vendor's own id for the resolved model.
	Model string
	// Body is the request body with the resolved model written back.
	Body []byte
	// Opened records that the vendor socket is up and the call is running.
	Opened func()
	// Release closes the booking and gives the slot back when no vendor
	// socket was opened. It is called at most once.
	Release func(ctx context.Context, reason string)
}

// OpenAIRealtimeSocketSurface is GET /v1/realtime with an upgrade, served
// only by an OpenAI credential.
func OpenAIRealtimeSocketSurface() Surface {
	return Surface{Name: "/v1/realtime", Providers: []ProviderID{ProviderOpenAI}}
}

// ElevenLabsSpeechSocketSurface is the ElevenLabs speech sockets, served
// only by an ElevenLabs credential.
func ElevenLabsSpeechSocketSurface() Surface {
	return Surface{Name: "/v1/text-to-speech/{voice_id}/stream-input", Providers: []ProviderID{ProviderElevenLabs}}
}

// ElevenLabsTranscriptionSocketSurface is the ElevenLabs realtime
// transcription socket, served only by an ElevenLabs credential.
func ElevenLabsTranscriptionSocketSurface() Surface {
	return Surface{Name: "/v1/speech-to-text/realtime", Providers: []ProviderID{ProviderElevenLabs}}
}
