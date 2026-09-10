Feature: Voice agents: reach an agent by phone
  As a team whose voice agent answers a phone number
  I want to register that number as a target in the app
  So that a scenario run can call it once the voice worker ships

  # @see https://github.com/langwatch/langwatch/issues/8014
  # The phone member is selectable behind a flag. Slice 2 adds the real Twilio
  # runner (a-leg outbound dial, deny-by-default allowlist, duration cap,
  # recording read), but it is inert by default: without the Twilio operator
  # environment every run path fails closed, and no worker dials it yet.

  # ---------------------------------------------------------------------------
  # Config schema
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A phone target stores its number in E.164 form
    Given a voice agent config for the phone transport with number " +14155550123 "
    When the config is validated
    Then it is accepted and the number is trimmed to "+14155550123"

  @unit
  Scenario: A phone target rejects a number that is not E.164
    Given a voice agent config for the phone transport with number "415-555-0123"
    When the config is validated
    Then it is rejected

  # ---------------------------------------------------------------------------
  # Runner (Twilio, inert until the voice worker dials it)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A phone target has no browser call
    Given the phone transport runner
    When a browser session mint is attempted
    Then it fails because phone targets have no browser call

  @unit
  Scenario: A phone run fails closed when Twilio is not configured
    Given the phone transport runner and no Twilio environment
    When the agent adapter is built
    Then it fails with the phone-unavailable message

  @unit
  Scenario: A phone target is dialled with an a-leg outbound call
    Given the phone transport runner, a Twilio environment and an allowlisted number
    When the agent adapter connects
    Then Twilio places an a-leg outbound call to that number

  @unit
  Scenario: A phone target refuses a callee that is not allowlisted
    Given the phone transport runner and a Twilio environment
    When the agent adapter connects to a number not in the project allowlist
    Then the call is refused before Twilio is reached

  @unit
  Scenario: A phone call's duration is capped
    Given the phone transport runner and a project cap above the ceiling
    When the agent adapter connects
    Then the a-leg call is placed with a duration clamped to the ceiling

  @unit
  Scenario: A finished phone recording is not ready until Twilio completes it
    Given a phone call whose Twilio recording is still processing
    When the finished call record is fetched
    Then no record is returned yet and the live transcript is kept

  # ---------------------------------------------------------------------------
  # Drawer option gating
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The phone option is hidden until the phone targets flag is on
    Given the voice agent editor with the phone targets flag off
    Then the "Reached via" list offers no Phone number option
    When the phone targets flag is on
    Then the "Reached via" list offers the Phone number option

  @integration
  Scenario: A phone target's drawer explains why Talk to it is off
    Given the voice agent editor open on a saved phone target
    Then the Talk to it button is disabled
    And its tooltip says browser calls are not available for phone targets
