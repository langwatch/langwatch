@unit
Feature: voicesim, a local stand-in for the voice providers a scenario call uses
  A scenario run against an ElevenLabs voice agent opens the agent's
  conversation socket through a signed URL, speaks the simulated caller with
  OpenAI text-to-speech, and may transcribe audio with OpenAI. voicesim answers
  just those calls with canned, deterministic data: tones for audio, a scripted
  agent, one fixed caller transcript. It checks no key: it is a dev shim.

  # Bound by Go tests in services/voicesim/voicesim_test.go and
  # tools/thuishaven/domain/overlay_voice_test.go, by their `// @scenario`
  # annotations, and by apps/voicesim-web/src/__tests__/calls-console.integration.test.tsx.
  # The Twilio phone transport is not faked: the scenario SDK dials api.twilio.com
  # with no way to point it elsewhere.

  Scenario: A scenario's ElevenLabs agent answers each caller turn
    Given voicesim is running
    When the scenario SDK asks for a signed URL for an agent
    Then the signed URL is this server's conversation socket for that agent
    When the SDK opens the socket and sends its initiation data
    Then voicesim answers with a conversation id and pcm_24000 audio formats both ways
    When the caller speaks and then falls silent
    Then voicesim sends the caller's transcript, the next scripted agent line and that line's audio as a tone
    And the next caller turn gets the next scripted line

  Scenario: Silence alone never starts a turn
    Given a caller that has not spoken
    When only silent audio frames arrive
    Then voicesim sends nothing
    And speech followed by 300 ms of silence ends exactly one turn

  Scenario: The caller's speech and transcription are canned
    When the SDK asks OpenAI's speech endpoint for pcm audio of a line
    Then voicesim answers a tone whose length follows the line, the same bytes every time
    And a request for any other audio format is refused with 400 in OpenAI's error shape
    And the transcription endpoint answers the fixed caller transcript for any audio

  Scenario: The console lists recent calls with their turns
    Given two calls have each finished a turn
    When the console reads /_sim/api/calls
    Then it lists both calls newest first, each with its turns, frame counts and protocol events
    And /_sim/api/status names the stack and the base URLs to point a provider at
    And a provider path voicesim does not fake answers 404, never the console page

  Scenario: The call log is bounded
    Given more than 200 calls have been made
    Then the console keeps only the 200 most recent

  Scenario: haven runs voicesim only when the worktree asks for it
    Given a worktree that has never been up
    When the developer runs "haven up"
    Then no voice lane runs
    When the developer runs "haven up +voice"
    Then a voice lane runs voicesim on a port haven allocated, routed at voice.<slug>.langwatch.localhost
    And the overlay sets ELEVENLABS_BASE_URL to it for every lane
    And the overlay leaves OPENAI_BASE_URL alone, since every OpenAI model call falls back to it

  Scenario: A developer's own ElevenLabs host wins
    Given the worktree's environment already names ELEVENLABS_BASE_URL
    When the developer runs "haven up +voice"
    Then the overlay does not set ELEVENLABS_BASE_URL
