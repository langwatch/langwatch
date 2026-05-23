Feature: MediaPart recognizes the post-extraction input_audio shape
  As a developer reviewing a voice scenario simulation
  I want the LangWatch UI to render an inline audio player for every voice turn
  So that I can listen to each agent / user turn directly from the trace timeline

  # Issue: #4138
  #
  # Scope: UI render leg only. The server-side audio extraction pipeline
  # (content-extractor.ts) already rewrites OpenAI Realtime API
  # `{type:"input_audio", input_audio:{data, format}}` parts into
  # `{type:"input_audio", input_audio:{url, mimeType}}` after externalizing
  # the bytes to stored_objects. This feature adds the matching render
  # branch in MediaPart so the post-extraction shape produces an
  # `<audio controls>` element.
  #
  # Out of scope: changes to content-extractor.ts output shape, wire
  # schema in event-schemas.ts, SDK transport, and any prod-side
  # extraction work tracked in #4139 / the langwatch/scenario SDK.

  Background:
    Given a simulation message renders through MediaPart
    And the stored-objects existence probe is mocked at the tRPC boundary

  # ---------------------------------------------------------------
  # AC1 — post-extraction input_audio shape renders an audio player
  # ---------------------------------------------------------------

  @integration
  Scenario: Post-extraction input_audio part renders a native audio element pointing at the stored URL
    Given a MediaPart receives a part with type "input_audio" and input_audio { url: "/api/files/stored-audio-id", mimeType: "audio/wav" }
    When the component renders
    Then a native <audio controls> element appears
    And its src attribute equals "/api/files/stored-audio-id"

  @integration
  Scenario: Post-extraction input_audio part with an mp3 mimeType still renders an audio element
    Given a MediaPart receives a part with type "input_audio" and input_audio { url: "/api/files/voice-turn-mp3", mimeType: "audio/mpeg" }
    When the component renders
    Then a native <audio controls> element appears with src "/api/files/voice-turn-mp3"

  @integration
  Scenario: Post-extraction input_audio part without a mimeType still renders an audio element
    Given a MediaPart receives a part with type "input_audio" and input_audio { url: "/api/files/no-mime-id" }
    When the component renders
    Then a native <audio controls> element appears with src "/api/files/no-mime-id"

  # ---------------------------------------------------------------
  # AC2 — existing canonical audio shape continues to render
  # (regression guard — the new branch must not break the old one)
  # ---------------------------------------------------------------

  @integration
  Scenario: Canonical url-source audio part still renders an audio element
    Given a MediaPart receives a part with type "audio" and source { type: "url", value: "/api/files/canonical-id", mimeType: "audio/mp3" }
    When the component renders
    Then a native <audio controls> element appears with src "/api/files/canonical-id"

  @integration
  Scenario: Legacy inline-data audio part still renders an audio element with a data URI
    Given a MediaPart receives a part with type "audio" and source { type: "data", value: <base64>, mimeType: "audio/mp3" }
    When the component renders
    Then a native <audio controls> element appears
    And its src attribute starts with "data:audio/mp3;base64,"

  # ---------------------------------------------------------------
  # AC3 — integration test coverage in MediaPart.integration.test.tsx
  # (covered by the scenarios above all carrying the @integration tag
  # and binding into MediaPart.integration.test.tsx)
  # ---------------------------------------------------------------

  @integration
  Scenario: MediaPart integration test suite includes an input_audio URL fixture
    Given MediaPart.integration.test.tsx
    When the test suite runs
    Then at least one test case renders a part with type "input_audio" and input_audio.url set
    And asserts that an <audio controls> element with the expected src is rendered

  # ---------------------------------------------------------------
  # AC4 — visual confirmation in prod (manual, post-merge)
  # Gated on #4139 (prod infra) and the langwatch/scenario SDK
  # transport PR. Captured here as a regression scenario so the
  # parity checker does not lose track of the AC; verification is
  # a documented manual followup, not an automated test.
  # ---------------------------------------------------------------

  @regression @manual
  Scenario: Voice scenario simulation page in prod shows inline audio controls per turn
    Given #4139 PR-A and the langwatch/scenario SDK transport PR have landed in prod
    And basic_greeting.py runs against drews-sandbox-owUldA
    When I open the resulting simulation run in the LangWatch UI
    Then every turn that carries audio shows an inline <audio controls> element
    And clicking play produces audible playback

  # ---------------------------------------------------------------
  # AC5 — content-extractor output shape is unchanged
  # (negative guard — proves the fix lives in the renderer, not the
  # extractor; the cleanup to canonicalize input_audio -> audio is
  # explicitly deferred)
  # ---------------------------------------------------------------

  @unit
  Scenario: content-extractor still emits input_audio parts with url and mimeType
    Given a scenario event whose content includes an input_audio part with inline base64 data
    When extractInlineMediaFromEvent runs
    Then the rewritten part has type "input_audio"
    And input_audio.url is "/api/files/<storedObjectId>"
    And input_audio.mimeType is set from the format -> MIME map
    And input_audio.data is undefined

  # ---------------------------------------------------------------
  # Guard scenarios — defensive coverage flagged by the plan as
  # risks / open questions
  # ---------------------------------------------------------------

  @unit
  Scenario: MediaPart discriminator prefers input_audio.url over any leftover input_audio.data
    Given a MediaPart receives an input_audio part where input_audio.url is set and input_audio.data is undefined
    When the component renders
    Then it does not construct a data: URI
    And the <audio> src equals input_audio.url

  # --- AC Coverage Map ---
  # AC1 "MediaPart renders <audio controls> for {type:'input_audio', input_audio:{url, mimeType}}"
  #   -> Scenario: Post-extraction input_audio part renders a native audio element pointing at the stored URL
  #   -> Scenario: Post-extraction input_audio part with an mp3 mimeType still renders an audio element
  #   -> Scenario: Post-extraction input_audio part without a mimeType still renders an audio element
  #   -> Scenario: MediaPart discriminator prefers input_audio.url over any leftover input_audio.data
  # AC2 "Existing {type:'audio', source:{...}} shape continues to render (regression test)"
  #   -> Scenario: Canonical url-source audio part still renders an audio element
  #   -> Scenario: Legacy inline-data audio part still renders an audio element with a data URI
  # AC3 "Integration test extends MediaPart.integration.test.tsx with an input_audio URL fixture"
  #   -> Scenario: MediaPart integration test suite includes an input_audio URL fixture
  # AC4 "Visual: voice-scenario simulation page in prod shows inline <audio controls> for each turn"
  #   -> Scenario: Voice scenario simulation page in prod shows inline audio controls per turn (@manual)
  # AC5 "No change to content-extractor.ts output shape"
  #   -> Scenario: content-extractor still emits input_audio parts with url and mimeType
