Feature: Audio model cost computation
  Speech synthesis is billed by how much text was spoken and transcription
  by how much audio was heard, not by tokens. A customer running TTS or STT
  through the gateway sees each call's real cost on its trace, computed
  from the model catalog's audio rates. Audio rates are hand-curated: the
  upstream price source only carries token prices.

  Background:
    Given the model catalog carries audio pricing for openai and elevenlabs models
    And audio calls through the gateway land as traces with their usage recorded

  Rule: Audio calls show their real cost, not zero

    @unit
    Scenario: a text-to-speech call is costed by the characters it spoke
      Given a text-to-speech call that synthesized 1000 characters
      When its trace is processed
      Then the span cost equals 1000 times the model's per-character rate

    @unit
    Scenario: a transcription call is costed by the audio it heard
      Given a transcription call that transcribed 60 seconds of audio
      When its trace is processed
      Then the span cost equals 60 times the model's per-second rate

    @unit
    Scenario: an audio call with no token usage still gets a cost
      Given an audio call reporting zero tokens but real audio usage
      When its trace is processed
      Then a non-zero cost is computed
      And a call with no usage of any kind still costs nothing

    @unit
    Scenario: a model priced only by audio usage is never silently free
      Given a catalog entry carrying only an audio rate and no token rates
      When a cost estimate runs with audio usage
      Then it produces usage times rate
      And an entry with no rates at all reports that it cannot price the call

  Rule: Transcribe models stop borrowing chat-model token rates

    @unit
    Scenario: gpt-4o-transcribe bills at its own audio rate, not gpt-4o's chat rate
      Given a transcription call on gpt-4o-transcribe that reports audio and output tokens
      When its trace is processed
      Then the cost comes from the transcribe model's own token rates
      And none of it comes from gpt-4o's chat token rates

    @unit
    Scenario: the duration-priced transcribe model bills by the second
      Given a transcription call on a model that reports a duration and no tokens
      When its trace is processed
      Then the cost equals the seconds times the model's per-second rate

    @unit
    Scenario: each transcribe model matches its own rate, not a shorter neighbour's
      Given transcribe model ids that start with one another
      When each one is priced
      Then every id lands on the rate published for that model

  Rule: Audio tokens are priced apart from text tokens

    @unit
    Scenario: an audio turn costs the audio rate on the trace, not the text rate
      Given a span reporting audio tokens beside its text token totals
      When its trace is processed
      Then each bucket is priced at its own rate
      And the same tokens priced flat at the text rate cost less

  Rule: Audio models stay out of chat and embedding pickers

    @unit
    Scenario: speech and transcription models are not offered as chat models
      Given the catalog's audio entries
      When a user picks a chat or embedding model for a provider
      Then no speech or transcription model appears among the options
