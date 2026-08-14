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
    Then the gateway routes the request through Bifrost's elevenlabs provider using the organization's ElevenLabs key
    And the response is 200 with binary audio bytes

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
