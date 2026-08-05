Feature: Verifying a webhook delivery from an SDK

  # A receiver cannot act on a delivery it has not authenticated, so every
  # integration has to verify the signature header before trusting the body.
  # Left to write that themselves, integrators reimplement a small piece of
  # cryptography from a prose description, and the mistakes are not the ones
  # they would catch in staging: the header carries MORE THAN ONE v1 during a
  # secret rotation, and a parser that keeps one of them rejects every
  # delivery for as long as the rotation lasts. Our own demo hand-rolled three
  # verifiers and all three had that bug.
  #
  # So both SDKs ship the verifier, and neither ships its own idea of the
  # algorithm: the cases below are generated from the code that signs real
  # deliveries, committed as fixtures, and read by both SDK suites. An SDK
  # that drifts from the sender fails against a file it cannot edit into
  # agreement.
  #
  # Bound scenarios run in
  # sdks/typescript/src/client-sdk/services/webhooks/__tests__/ and
  # sdks/python/tests/test_webhook_signature.py.

  As an engineer receiving LangWatch webhooks
  I want one call that tells me whether to trust a delivery, and why not when
  I should not
  So that authenticating a webhook is not a cryptography exercise I can get
  subtly wrong.

  Rule: A delivery is trusted only when it is both authentic and fresh

    @unit
    Scenario: A delivery signed with a secret the receiver holds is accepted
      Given a receiver holding the endpoint's signing secret
      When a delivery signed with that secret arrives inside the freshness window
      Then the verifier accepts it and the handler may act on the body

    @unit
    Scenario: A body changed in transit is refused as a bad signature
      Given a receiver holding the endpoint's signing secret
      When the body is altered after signing
      Then the verifier refuses it
      And the reason given is a signature mismatch rather than a stale delivery

    @unit
    Scenario: A delivery outside the freshness window is refused as stale
      Given a receiver holding the endpoint's signing secret
      When a correctly signed delivery arrives long after it was signed
      Then the verifier refuses it
      And the reason given is staleness, which an operator reads as a clock
      problem or a replay rather than as tampering

    @unit
    Scenario: A signature header the receiver cannot parse is refused as malformed
      Given a request carrying a header that is not the signature scheme
      When the receiver verifies it
      Then the verifier refuses it
      And the reason given is a malformed header, which an operator reads as
      something other than LangWatch posting to the URL

  Rule: A secret rotation never costs the receiver a delivery

    @unit
    Scenario: During a secret rotation either secret the receiver holds verifies the delivery
      Given a rotation window in which deliveries are signed with both the new
      and the previous secret
      When a receiver that has already swapped verifies a delivery
      Then it is accepted
      And a receiver that has not swapped yet also accepts the same delivery
      And a receiver holding both accepts it too
      # The header carries one signature per valid secret. Accepting when ANY
      # of them matches is what lets a receiver roll on its own schedule.

  Rule: The receiver is told when the fault is its own configuration

    @unit
    Scenario: A receiver with no secret configured is told its configuration is wrong
      Given a receiver started without its signing secret
      When a perfectly good delivery arrives
      Then the verifier reports a configuration mistake
      And it does not report the delivery as forged, which would send the
      operator hunting an attacker instead of a missing environment variable

  Rule: What was received is what gets verified

    @unit
    Scenario: The exact bytes received are what gets verified
      Given a delivery whose body contains non-ASCII text
      When the receiver verifies the raw bytes it was sent
      Then the verifier accepts it
      # A body parsed and re-serialized before verification hashes differently,
      # so a verifier that accepts an object instead of bytes would teach the
      # mistake it exists to prevent.

  Rule: The SDKs agree with the sender, not with themselves

    @unit
    Scenario: Both SDK verifiers reach the sender's verdict on every generated case
      Given the signature cases generated from the code that signs deliveries
      When each SDK verifier judges every case
      Then its verdict matches the one the case records
      And the accepted, stale, mismatched and malformed verdicts are each
      exercised
