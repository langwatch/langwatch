@unit
Feature: voicesim, a local stand-in for the voice providers a scenario call uses
  A scenario run against an ElevenLabs voice agent opens the agent's
  conversation socket through a signed URL, speaks the simulated caller with
  OpenAI text-to-speech, and may transcribe audio with OpenAI. voicesim answers
  just those calls with canned, deterministic data: tones for audio, a scripted
  agent, one fixed caller transcript. It checks no key: it is a dev shim.

  # Bound by Go tests in services/voicesim/voicesim_test.go and
  # tools/thuishaven/domain/overlay_voice_test.go, by their `// @scenario`
  # annotations, by apps/voicesim-web/src/__tests__/calls-console.integration.test.tsx,
  # and by the product's loopback-rule tests in model-provider, gateway and scenario.
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
    Given more calls than VOICESIM_MAX_CALLS (default 200) have been made
    Then the console keeps only that many of the most recent
    And one call keeps at most VOICESIM_MAX_EVENTS_PER_CALL (default 500) protocol events, counting the rest

  Scenario: A seeded voicesim starts with a sample call
    Given voicesim starts with VOICESIM_SEED=1
    Then the console lists one finished two-turn sample call
    And without the seed it starts empty

  Scenario: haven runs voicesim only when the worktree asks for it
    Given a worktree that has never been up
    When the developer runs "haven up"
    Then no voice lane runs
    When the developer runs "haven up +voice"
    Then voicesim runs on a port haven allocated, routed at voice.<slug>.langwatch.localhost
    And the overlay sets ELEVENLABS_BASE_URL to it for every lane
    And the overlay sets the product's dev switch VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS=1
    And the overlay leaves OPENAI_BASE_URL alone, since every OpenAI model call falls back to it

  Scenario: haven seeds the ElevenLabs provider at voicesim
    Given the worktree's environment names no ElevenLabs key
    When the developer runs "haven up +voice"
    Then the overlay adds a dummy ELEVENLABS_API_KEY
    And the storage seed stores an ElevenLabs provider row whose base URL is voicesim

  Scenario: The product reaches a loopback voice host only under the dev switch
    Given the dev switch VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS is off
    Then an ElevenLabs base URL on 127.0.0.1 or localhost is refused by the provider registry
    And the gateway swaps it for api.elevenlabs.io
    And a ws:// signed URL on a loopback host is rejected
    When the switch is on
    Then an http or ws URL on 127.0.0.1 or localhost with an explicit port is accepted at all three points

  Scenario: The dev switch never opens anything but loopback
    Given the dev switch is on
    Then a private address such as 10.0.0.5, the metadata address 169.254.169.254, plain http to a remote host, a loopback name without a port and a hostname that only looks local are all still refused
    And the provider registry itself never carries the switch: only the dev storage seed builds the switched-on form

  Scenario: A developer's own ElevenLabs host wins
    Given the worktree's environment already names ELEVENLABS_BASE_URL
    When the developer runs "haven up +voice"
    Then the overlay does not set ELEVENLABS_BASE_URL
    And it does not set the dev switch either
