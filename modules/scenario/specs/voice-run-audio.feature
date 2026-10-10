Feature: A headless voice run's whole-call recording

  GET /api/voice/run/:scenarioRunId/audio plays a phone or headless voice run's
  recording back through LangWatch, so the provider key never reaches the browser.

  @unit
  Scenario: A phone run's published Twilio recording is relayed
    Given a phone run whose Twilio recording is published
    When a viewer of the project requests the run's audio
    Then the recording's bytes are relayed as audio/wav
    And the response is never cached

  @unit
  Scenario: A run whose provider key is missing is refused by name
    Given a voice run whose provider key is no longer configured
    When a viewer of the project requests the run's audio
    Then the request is refused with voice_recording_key_missing
