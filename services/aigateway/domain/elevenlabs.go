package domain

// ElevenLabs' own audio wire, brokered rather than translated.
//
// The gateway already serves ElevenLabs speech and transcription through the
// OpenAI-shaped /v1/audio routes, which any provider can answer. That covers a
// caller willing to write OpenAI-shaped requests. It does not cover a caller
// who already uses the ElevenLabs SDK: that SDK posts to this vendor's own
// paths with this vendor's own body, so its traffic went straight to the
// vendor and none of it was metered. These two routes mirror the vendor's
// paths so an ElevenLabs SDK reaches the gateway by base URL alone.

// ElevenLabsModelField is where ElevenLabs names the model on both of its
// audio routes: a JSON field on synthesis, a form part on transcription.
// Neither is the "model" every translated route uses, so the resolver writes
// the resolved id here instead.
const ElevenLabsModelField = "model_id"

// ElevenLabsDefaultSpeechModel is the model ElevenLabs synthesizes with when
// a request names none, so the gateway meters and gates the same model the
// vendor would have used. Naming it here rather than leaving the field empty
// is what lets the virtual key's allowlist and aliases apply to a request
// that omitted the model, exactly as they apply to one that stated it.
const ElevenLabsDefaultSpeechModel = "eleven_multilingual_v2"

// ElevenLabsAudioRequest is what an ElevenLabs-native audio route needs
// beyond the body.
type ElevenLabsAudioRequest struct {
	// VoiceID is the voice the synthesis path names. Empty on transcription,
	// which takes no voice.
	VoiceID string
	// RawQuery is the caller's query string without the leading "?".
	// output_format, enable_logging and the optimize-latency setting ride
	// there on this vendor's wire rather than in the body, so dropping it
	// would silently return audio in a format the caller did not ask for.
	RawQuery string
}

// ElevenLabsSpeechSurface is POST /v1/text-to-speech/{voice_id}: ElevenLabs'
// own synthesis path, served only by an ElevenLabs credential.
//
// The pin is what keeps the body on the vendor the caller named. The request
// reaches the vendor as written, so a fallback to another provider would post
// an ElevenLabs body to an API that cannot parse it, and would spend a
// credential the caller never chose.
func ElevenLabsSpeechSurface() Surface {
	return Surface{
		Name:      "/v1/text-to-speech/{voice_id}",
		Providers: []ProviderID{ProviderElevenLabs},
	}
}

// ElevenLabsTranscriptionSurface is POST /v1/speech-to-text: ElevenLabs' own
// transcription path, served only by an ElevenLabs credential, for the same
// reason the synthesis surface pins.
func ElevenLabsTranscriptionSurface() Surface {
	return Surface{
		Name:      "/v1/speech-to-text",
		Providers: []ProviderID{ProviderElevenLabs},
	}
}
