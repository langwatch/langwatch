Feature: Gateway audio endpoints, OpenAI-compatible TTS and STT for OpenAI and ElevenLabs
  As a developer running voice agents (and as Scenario's own voice test harness)
  I want the gateway to serve /v1/audio/speech and /v1/audio/transcriptions on a virtual key
  So that voice traffic gets the same governance, observability, and cost tracking as chat
  And so pointing an OpenAI SDK's base_url at the gateway is all a voice app needs to change

  # The contract (§3) has declared both routes since v0.1: this feature makes
  # them real. Bifrost v1.4.22 (already pinned) ships SpeechRequest and
  # TranscriptionRequest with both an `openai` and an `elevenlabs` provider,
  # so no Bifrost upgrade is required.

  Background:
    Given the gateway is running with a control plane
    And a virtual key "vk-lw-test" bound to an organization with an OpenAI API key configured
    And the organization also has an ElevenLabs API key configured

  # ============================================================
  # Group: Text to speech (POST /v1/audio/speech)
  # ============================================================

  @integration
  Scenario: OpenAI-shape TTS request returns binary audio
    When the client POSTs /v1/audio/speech with the OpenAI wire shape
      | field           | value                    |
      | model           | openai/gpt-4o-mini-tts   |
      | voice           | nova                     |
      | input           | Hello from the gateway.  |
      | response_format | mp3                      |
    Then the response is 200 with binary audio bytes in the body
    And the Content-Type is the audio MIME type for the requested format
    And the body is NOT a JSON envelope, so an OpenAI SDK's `client.audio.speech.create(...)` consumes it unchanged

  @integration
  Scenario: PCM response format passes through for realtime consumers
    When the client requests response_format "pcm"
    Then the raw PCM bytes are returned verbatim
    And no JSON wrapping or base64 encoding is applied
    # Scenario's voice harness consumes exactly this shape (pcm16/24000).

  @unit
  Scenario: PCM means 24kHz on every provider, matching OpenAI semantics
    When the client requests response_format "pcm" for an elevenlabs model
    Then the gateway asks ElevenLabs for output_format "pcm_24000"
    # Bifrost's own mapping picks pcm_44100, which is gated to the ElevenLabs
    # Pro tier and is the wrong sample rate for the OpenAI pcm contract.

  @integration
  Scenario: ElevenLabs TTS through the same OpenAI wire shape
    When the client POSTs /v1/audio/speech with model "elevenlabs/eleven_flash_v2" and a voice id in `voice`
    Then the gateway calls ElevenLabs with the organization's ElevenLabs key
    And the response is 200 with binary audio bytes

  @unit
  Scenario: An ElevenLabs model on the OpenAI speech route streams through the vendor's streaming path
    When the gateway dispatches an OpenAI-shaped speech request that resolved to an ElevenLabs credential
    Then it posts to the vendor's /v1/text-to-speech/{voice_id}/stream path with the voice from the `voice` field
    And the vendor body carries the input as "text", the resolved model as "model_id" and the speed as a voice setting
    And the response is labelled with the Content-Type of the format the caller asked for

  @unit
  Scenario: A bare model name resolves like chat models do
    When the client sends model "gpt-4o-mini-tts" with no provider prefix
    Then model resolution applies the virtual key's aliases and allowlist exactly as /v1/chat/completions does
    And the explicit "provider/model" form bypasses aliases, as everywhere else

  # ============================================================
  # Group: Speech to text (POST /v1/audio/transcriptions)
  # ============================================================

  @integration
  Scenario: OpenAI-shape multipart transcription returns the transcript JSON
    When the client POSTs /v1/audio/transcriptions as multipart/form-data
      | part  | value                       |
      | file  | <a short WAV of speech>     |
      | model | openai/gpt-4o-transcribe    |
    Then the response is 200 with a JSON body carrying a non-empty "text" field
    And an OpenAI SDK's `client.audio.transcriptions.create(...)` consumes it unchanged

  @integration
  Scenario: ElevenLabs transcription through the same multipart shape
    When the multipart `model` part is "elevenlabs/scribe_v1"
    Then the gateway routes through Bifrost's elevenlabs provider
    And the response is 200 with the transcript in "text"

  # The gateway owns two parts of the form: the model, which it resolves, and
  # the file. Every other part is the caller's request to the provider. On
  # OpenAI and Azure OpenAI credentials the gateway dials the provider itself
  # and returns its body as it came, so a new provider option or response
  # format needs no gateway change.

  @unit
  Scenario: Every transcription form field reaches the provider as the caller sent it
    When the client sends chunking_strategy, known_speaker_names[], known_speaker_references[], timestamp_granularities[], include[], stream and a field the gateway has never heard of
    Then the provider receives the resolved model first, then every part under the caller's name and in the caller's order
    And repeated parts keep every value
    And the audio and its filename are unchanged

  @unit
  Scenario: A transcript comes back in the response format the caller asked for
    When the client asks for response_format "json", "text", "srt", "vtt" or "verbose_json"
    Then the provider's body and Content-Type reach the client unchanged
    And a JSON body is metered by the usage it states, as tokens or as seconds
    And a text, srt or vtt body, which states no usage, is metered by the duration of the uploaded audio
    And the span holds the transcript in every format

  @unit
  Scenario: A diarized transcription returns the provider's segments unchanged
    When the client asks "gpt-4o-transcribe-diarize" for response_format "diarized_json"
    Then the response is 200 with the provider's segments, each with its speaker, start, end and text
    And the body carries no extra_fields
    And the provider's organization header is not passed on
    And the spend record carries the token usage the body states

  @unit
  Scenario: A transcript served through Bifrost carries no internal fields
    Given a provider the gateway cannot dial directly
    When the transcript is marshalled for the client
    Then it carries no extra_fields, raw provider response or provider response headers

  @integration
  Scenario: A diarized transcription of a short clip succeeds against the real provider
    Given a clip of a few seconds synthesized through /v1/audio/speech
    When the client transcribes it with "gpt-4o-transcribe-diarize", response_format "diarized_json" and chunking_strategy "auto"
    Then the response is 200 with segments that carry speaker, start, end and text

  @integration
  Scenario: A long recording is diarized with a chunking strategy and known speakers
    Given a recording longer than 30 seconds and two reference clips
    When the client sends chunking_strategy "auto" with two known_speaker_names[] and two known_speaker_references[]
    Then the response is 200 with segments labelled by a known speaker name

  @integration
  Scenario: Speech and transcription stream against the real provider
    When the client asks for speech with stream_format "sse" and for a transcription with stream "true"
    Then both answer as event streams that end with their final event

  @integration
  Scenario: ElevenLabs synthesis streams against the real vendor
    When the client calls /v1/text-to-speech/{voice_id}/stream and /stream/with-timestamps
    Then both answer 200 with the vendor's own Content-Type

  @unit
  Scenario: Oversized uploads are rejected before provider dispatch
    Given a multipart upload larger than the transcription size cap
    When the request is parsed
    Then the gateway responds 413 without contacting any provider
    And the cap matches the largest upload OpenAI's own endpoint accepts (25 MB)

  @unit
  Scenario: A multipart request with no file part fails informatively
    When the form has a model but no "file" part
    Then the gateway responds 400 naming the missing "file" field
    And no provider is contacted

  # ============================================================
  # Group: Streaming (audio leaves as the provider produces it)
  # ============================================================

  # A voice agent plays audio while it is still being synthesized, so the
  # gateway relays each read of the provider's body and flushes it. OpenAI
  # and Azure OpenAI are dialed directly for this; providers that answer
  # only with a complete body are relayed as one chunk.

  @unit
  Scenario: Synthesized speech is relayed as the provider produces it
    Given a provider that produces its audio in five chunks, one at a time
    When the client POSTs /v1/audio/speech
    Then the client holds each chunk before the provider has produced the next
    And the provider's Content-Type and request id reach the client
    And the spend record carries the character count of the input, counted in runes
    And the span holds the input text and no audio bytes

  @unit
  Scenario: Speech events are relayed unchanged and the final event states the usage
    When the client sends stream_format "sse"
    Then stream_format reaches the provider with the rest of the body
    And the speech.audio.delta and speech.audio.done events reach the client byte for byte
    And the token usage on speech.audio.done is the usage reported, beside the character count
    And the usage is read correctly when the final event spans two reads

  @unit
  Scenario: A speech stream cut before its final event is charged by characters
    Given a provider that closes its event stream without sending speech.audio.done
    When the client reads the stream to its end
    Then the events the provider did send reach the client, followed by an error event
    And the spend settles once, as a failed outcome carrying the character count
    And the span carries the same upstream error marker a cut chat stream carries

  @unit
  Scenario: A character-priced voice is charged when the caller disconnects mid-stream
    Given the provider accepted the text and started sending audio
    When the client hangs up after the first chunk
    Then the spend settles exactly once, carrying the full character count
    And the span is marked as cut
    # The provider bills the text it accepted, whatever the caller heard.

  @unit
  Scenario: A streamed transcription relays the provider's events unchanged
    When the client POSTs /v1/audio/transcriptions with stream "true"
    Then stream, chunking_strategy, include[] and timestamp_granularities[] reach the provider
    And a form field the gateway has never heard of reaches the provider too
    And the transcript.text.delta and transcript.text.done events reach the client byte for byte
    And the usage on transcript.text.done is the usage reported, as tokens or as seconds
    And an event that states no usage is charged the duration of the uploaded audio

  @unit
  Scenario: A streamed transcription's span holds the transcript
    When a streamed transcription closes its span
    Then the span output is the text of transcript.text.done
    And for a stream cut before that event it is the deltas received, joined

  @unit
  Scenario: A transcription stream cut before its final event is charged the uploaded duration
    Given a provider that closes its event stream without sending transcript.text.done
    When the client reads the stream to its end
    Then the events the provider did send reach the client
    And the usage reported is the duration read from the uploaded file itself
    # WAV, FLAC, Ogg and MP4 state their length. MP3 is read from its Xing
    # header or its constant bitrate. Any other container is estimated from
    # its size at 64 kbps.

  @unit
  Scenario: A model that ignores stream answers with one transcript body
    Given a model that answers stream "true" with a single JSON body
    When the client POSTs /v1/audio/transcriptions with stream "true"
    Then the JSON body reaches the client with the provider's Content-Type
    And the usage the body states is the usage reported

  @unit
  Scenario: Streaming a transcription on a provider that cannot stream is refused
    When the client sends stream "true" for a model on a provider other than OpenAI or Azure OpenAI
    Then the gateway responds 400 unsupported_parameter, saying to send the request without stream
    And stream_format "sse" on such a provider is refused the same way
    And no provider is contacted

  @unit
  Scenario: A provider refusal on a streamed audio route reaches the caller in the provider's words
    When the provider answers a speech request with HTTP 400 and its own error body
    Then the client receives the provider's status and message
    And the spend settles once, as a failed outcome with no characters charged

  @unit
  Scenario: The gateway adds under 20 ms to the first audio byte
    Given a local provider that sends its first audio bytes at once
    When the same request is timed directly and through the gateway over real sockets
    Then the median time to the first audio byte through the gateway is under 20 ms above the direct one

  # ============================================================
  # Group: ElevenLabs' own audio paths, mirrored
  # ============================================================

  # The OpenAI-shaped routes above cover a caller willing to write
  # OpenAI-shaped requests. An ElevenLabs SDK is not: it posts to that
  # vendor's own paths with that vendor's own body, so its traffic went
  # straight to the vendor and none of it was metered. These routes
  # mirror the vendor's paths so an ElevenLabs SDK reaches the gateway by
  # base URL alone. Bifrost cannot forward them (its ElevenLabs provider
  # answers Passthrough with unsupported-operation), so the gateway calls
  # the vendor itself the way the session mint does.

  @unit
  Scenario: An ElevenLabs SDK reaches the native audio routes unchanged
    When the client POSTs /v1/text-to-speech/{voice_id} with the ElevenLabs wire shape
    And it authenticates with the xi-api-key header the SDK already sends
    Then the response is 200 with the vendor's audio bytes and its own Content-Type
    And the voice from the URL path and the caller's query string both reach the vendor
    And the model resolves through the virtual key's aliases and allowlist like every other route

  @unit
  Scenario: ElevenLabs' own synthesis path reaches the vendor unchanged
    When the gateway dispatches a native synthesis request
    Then every field of the caller's body, including voice settings, is forwarded as written
    And the one exception is "model_id", which carries the model resolution settled on
    And no "model" field is invented, because no ElevenLabs endpoint reads one
    And the character count of the spoken text is the usage measure reported
    # The vendor's character-cost response header is credits under the
    # account's own plan, not characters, and it already carries the model's
    # price factor, so rating it per character would apply that factor twice.

  @unit
  Scenario: ElevenLabs' own transcription path reaches the vendor unchanged
    When the gateway dispatches a native transcription request
    Then every text form part the caller sent is carried through to the vendor
    And the one exception is "model_id", which carries the model resolution settled on
    And the audio duration the vendor states is the usage measure reported
    And a request naming a cloud_storage_url instead of a file is accepted

  @unit
  Scenario: ElevenLabs' streaming synthesis paths reach the vendor unchanged
    When the client POSTs /v1/text-to-speech/{voice_id}/stream or /v1/text-to-speech/{voice_id}/stream/with-timestamps
    Then the request reaches the same path on the vendor, with the caller's query string
    And each chunk is relayed before the vendor has produced the next
    And the vendor's Content-Type reaches the client: audio for /stream, JSON for /stream/with-timestamps
    And the spend record carries the character count and the resolved model

  @unit
  Scenario: The streaming ElevenLabs routes honor the virtual key's model allowlist
    Given a virtual key that allows only "eleven_flash_v2_5"
    When the client calls either streaming route with model_id "eleven_multilingual_v2"
    Then the gateway responds 400 model_not_allowed and contacts no provider

  @unit
  Scenario: An ElevenLabs synthesis larger than the cap is stopped while it streams
    Given a vendor that keeps sending audio past 32 MiB
    When the gateway relays the synthesis
    Then the bytes under the cap are relayed as they arrive
    And the stream ends with a provider error once the running count passes the cap
    And the character count is still the usage reported

  @unit
  Scenario: Asynchronous transcription is refused rather than billed at zero
    When the client sends a "webhook" part asking the vendor to answer later
    Then the gateway responds 400 naming the webhook part, and contacts no provider
    # The vendor's early answer carries no duration and no word timings, so the
    # spend record would confirm at zero seconds for audio the customer was
    # charged for, and the gateway has no settlement path for the delivery that
    # follows.

  @unit
  Scenario: A native ElevenLabs route refuses a key with no ElevenLabs credential
    Given a virtual key holding no ElevenLabs credential
    When the client calls either native route
    Then the request is refused and no provider is contacted
    # The body is this vendor's own wire, so falling back would spend a
    # credential the caller never named on an API that cannot read it.

  @integration
  Scenario: A native ElevenLabs synthesis call bills the characters it spoke
    When the client synthesizes speech through /v1/text-to-speech/{voice_id}
    Then the response carries real audio the vendor produced
    And the spend record carries the character count in input_chars
    And the rated cost equals the characters times the model's per-character rate

  @integration
  Scenario: A native ElevenLabs transcription call bills the seconds it heard
    When the client transcribes audio through /v1/speech-to-text
    Then the response carries the transcript the vendor produced
    And the spend record carries the audio duration in audio_ms
    And the rated cost equals the duration times the model's per-second rate

  # ============================================================
  # Group: Governance (the same pipeline as chat)
  # ============================================================

  @unit
  Scenario: Audio requests authenticate exactly like chat
    When a request carries no virtual key, or a revoked one
    Then the response is the same 401 the chat endpoint returns

  @unit
  Scenario: The virtual key's model allowlist applies
    Given a virtual key whose models_allowed does not include the requested audio model
    When the client calls either audio endpoint with that model
    Then the request is rejected with the standard model_not_allowed error

  @unit
  Scenario: A missing provider key is a clear terminal error
    Given an organization with no ElevenLabs key configured
    When a request targets "elevenlabs/eleven_flash_v2"
    Then the response names the missing provider configuration
    And it is the same no-provider-configured error shape chat returns

  @unit
  Scenario: Budgets and rate limits gate audio calls
    Given a virtual key over its budget, or over its rate limit
    When the client calls either audio endpoint
    Then the request is blocked with the same error the chat endpoint emits

  @integration
  Scenario: A character-priced call debits the budget it was admitted under
    Given a virtual key with a budget and a character-priced speech model
    When the client synthesizes speech through the gateway
    Then the call's character count reaches the spend record
    And the budget moves by the characters times the model's per-character rate
    # A quantity that stops before the spend wire rates at zero, so a
    # call that cost real money debits nothing at all.

  @integration
  Scenario: A duration-priced transcription debits the budget it was admitted under
    Given a virtual key with a budget and a second-priced transcription model
    When the client transcribes audio through the gateway
    Then the audio duration reaches the spend record
    And the budget moves by the duration times the model's per-second rate

  @integration
  Scenario: Upstream provider errors pass through transparently
    When the provider rejects the request (e.g. an invalid voice, HTTP 400)
    Then the gateway forwards the provider's status code and error body
    And does not wrap it in an opaque gateway error
    And a 4xx does not trigger credential fallback, per the standard retry classification

  # ============================================================
  # Group: Observability and cost
  # ============================================================

  @integration
  Scenario: A TTS call lands as a trace with character usage
    When a speech request completes
    Then a gateway span is exported for the call with the resolved model
    And the span carries the input character count as the usage measure TTS is priced by

  @integration
  Scenario: A transcription call lands as a trace with duration usage
    When a transcription request completes
    Then a gateway span is exported with the resolved model
    And the span carries the audio duration (or the provider's token usage when reported) as the measure STT is priced by

  @integration
  Scenario: A span states its audio tokens apart from its text tokens
    Given a model that answers in audio tokens and prices them above text
    When the call completes
    Then the span carries the audio token counts under their own attributes
    And the text token attributes exclude them, as the cache counts already are
    And the trace cost equals the cost the budget was charged

  # ============================================================
  # Group: Dogfood (proven with the Scenario voice harness)
  # ============================================================

  # Exercised live on PR #6168 (OpenAI-model and ElevenLabs-model runs, both
  # success: True); automation is tracked in issue #6180 and lands when the
  # Scenario repo's voice CI points at the deployed gateway.
  @e2e @unimplemented
  Scenario: Scenario's voice tests run end to end through the gateway
    Given OPENAI_BASE_URL pointing at the gateway and a virtual key as OPENAI_API_KEY
    When a Scenario voice test synthesizes user turns (TTS) and the judge transcribes segments (STT)
    Then the run completes with result.success without any direct provider call
    And the gateway shows the audio usage for the run
