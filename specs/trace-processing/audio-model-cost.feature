Feature: Audio model cost computation
  TTS models bill per input character synthesized and STT models per second
  of audio transcribed — units that carry no token usage at all. The gateway
  records them on audio spans as gen_ai.usage.input_chars and
  gen_ai.usage.audio_seconds, and the catalog's audio entries carry matching
  inputCostPerCharacter / inputCostPerSecond rates in llmModels.overlay.json
  (hand-curated: the OpenRouter price sync has no per-character or
  per-second data, and it overwrites the base llmModels.json wholesale).

  Background:
    Given the model catalog carries audio entries for openai and elevenlabs
    And the gateway stamps audio usage attributes on gen_ai.speech and gen_ai.transcription spans

  Rule: Character- and second-priced usage produces a non-zero span cost

    @unit
    Scenario: a TTS span is priced from its character count
      Given a span for model "elevenlabs/eleven_flash_v2" carrying gen_ai.usage.input_chars = 1000
      And the span reports zero token usage
      When the span cost is computed
      Then the cost is 1000 times the model's per-character rate

    @unit
    Scenario: an STT span is priced from its transcribed seconds
      Given a span for model "elevenlabs/scribe_v1" carrying gen_ai.usage.audio_seconds = 60
      And the span reports zero token usage
      When the span cost is computed
      Then the cost is 60 times the model's per-second rate

    @unit
    Scenario: audio usage alone unlocks the registry lookup
      Given a span with zero tokens and zero cache counts but positive audio usage
      When the span cost is computed
      Then the static registry is still consulted instead of short-circuiting to zero

    @unit
    Scenario: estimateCost prices per-character and per-second rates
      Given a registry entry carrying only inputCostPerCharacter or inputCostPerSecond
      When estimateCost runs with inputCharacters or audioSeconds usage
      Then it returns usage times rate instead of undefined

  Rule: Transcribe models stop borrowing chat-model token rates

    @unit
    Scenario: gpt-4o-transcribe matches its own explicit entry, not gpt-4o's
      Given the catalog carries an explicit "openai/gpt-4o-transcribe" entry priced per second
      When a span for "openai/gpt-4o-transcribe" is matched against the registry
      Then the explicit transcribe entry wins over the gpt-4o prefix match

  Rule: Audio catalog entries stay out of chat and embedding selectors

    @unit
    Scenario: audio-mode models are not offered as chat models
      Given the catalog's audio entries carry mode "audio"
      When provider model options are listed for mode "chat"
      Then no TTS or STT model appears in the list
