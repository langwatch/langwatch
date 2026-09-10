Feature: Voice agents: reach an agent by phone
  As a team whose voice agent answers a phone number
  I want to register that number as a target in the app
  So that a scenario run can call it once the voice worker ships

  # @see https://github.com/langwatch/langwatch/issues/8014
  # Slice 1 is additive and inert: the phone member is selectable behind a flag,
  # but every run over phone fails with a clear message until the voice worker
  # that dials it exists.

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
  # Runner (stub until the voice worker ships)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A phone target has no browser call
    Given the phone transport runner
    When a browser session mint is attempted
    Then it fails because phone targets have no browser call

  @unit
  Scenario: Running a phone target before the voice worker exists fails with a clear message
    Given the phone transport runner
    When any of its call methods is invoked
    Then it fails with a message that points at issue 8014

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
