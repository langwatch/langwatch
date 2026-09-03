Feature: Gateway realtime-session reconciliation worker

  Scenario: Reconciliation confirms a completed ElevenLabs conversation
    Given an OPEN ElevenLabs session with a recorded conversation id older than two minutes
    When the reconciliation worker reads a terminal conversation with a positive duration
    Then it confirms the session using the rounded duration in milliseconds

  Scenario: A minted credential was never used
    Given an eligible OPEN ElevenLabs session whose conversation does not exist
    When the reconciliation worker reads the vendor conversation
    Then it expires the session and releases its open-session slot

  Scenario: A vendor report is incomplete
    Given a terminal conversation without a positive finite duration
    When the reconciliation worker reads the vendor conversation
    Then it leaves the session open for a later poll or the expiry sweep
