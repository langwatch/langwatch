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

  # ---------------------------------------------------------------------------
  # Worker mode and media listener (slice 3)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The voice worker reads its three infrastructure environment variables
    Given the voice worker environment with no variables set
    When the worker environment is read
    Then voice worker only is off and the websocket port defaults to 3300
    And only the literal "true" turns voice worker only on

  @unit
  Scenario: A voice worker refuses to start without a public base URL
    Given the voice worker environment with voice worker only on and no public base URL
    When the worker environment is read
    Then it fails because the worker cannot be reached without a public origin

  @unit
  Scenario: A voice worker boots only the voice subsystems
    Given voice worker only is on
    When the worker boot plan is resolved
    Then it boots the scenario processor, the media listener and metrics
    And it skips ingestion, anomaly, governance, poller and telemetry

  @unit
  Scenario: A voice worker runs only voice jobs
    Given a scenario execution pool that accepts only voice jobs
    When a non-voice job is submitted
    Then the pool refuses it so another pod runs it
    And a voice job submitted to the same pool starts

  @unit
  Scenario: The media listener answers its health check and refuses everything else
    Given the voice media listener is running
    When the health path is requested
    Then it answers ok
    And any other path answers not found

  @unit
  Scenario: The media listener refuses an upgrade on a non-media path
    Given the voice media listener is running
    When an upgrade arrives on a path that is not a Twilio media path
    Then the upgrade is closed with not found before any audio

  @unit
  Scenario: The media listener refuses an unknown or expired nonce
    Given the voice media listener is running
    When an upgrade arrives with a nonce that is unknown or has expired
    Then the upgrade is closed with forbidden before any audio

  @unit
  Scenario: The media listener hands a valid call's socket to its scenario child
    Given the voice media listener is running with a nonce registered to a child
    When an upgrade arrives on that nonce's media path
    Then the raw socket is handed to the registered child

  @integration
  Scenario: A handed-off media socket arrives at the scenario child process
    Given a real scenario child process with an inter-process channel
    And a nonce registered to that child
    When an upgrade arrives on that nonce's media path
    Then the child receives the socket handle and the bytes read during the upgrade
