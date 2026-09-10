Feature: Voice agents: reach an agent by phone
  As a team whose voice agent answers a phone number
  I want to register that number as a target in the app
  So that a scenario run can dial it through our Twilio account

  # @see https://github.com/langwatch/langwatch/issues/8014
  # Slice 2 makes the phone runner real: a scenario run dials the target as an
  # a-leg outbound call through the project's Twilio account. Credentials are a
  # per-project Twilio entry in Settings > Model Providers (no operator env),
  # and there is no user-facing callee allowlist.

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
  # Dialing a phone target (the Twilio runner)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A phone call dials the target number over the account's own line
    Given a phone target with a valid Twilio credential
    When the run places the call
    Then the adapter dials the target as an a-leg call from the account's own number

  @unit
  Scenario: A phone call allows only the dialled number
    Given a phone target with a valid Twilio credential
    When the run places the call
    Then only the dialled target is passed to the transport's internal allowlist

  @unit
  Scenario: A phone call's duration is capped at the transport's hard limit
    Given a project configured with a call limit above the phone transport's cap
    When a phone run starts
    Then the call is placed with the transport's own maximum duration, not the project's larger limit

  @unit
  Scenario: Ending a phone call while it is live hangs up the call
    Given a live phone call
    When the whole-call limit elapses
    Then the runner ends the call by hanging it up

  # ---------------------------------------------------------------------------
  # Default Twilio adapter factory (identity and delegation)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The default phone factory returns the SDK's own adapter instance
    Given the default Twilio agent factory builds an adapter for a phone target
    When the SDK constructs its own adapter for that target
    Then the transport returns that exact SDK adapter, not a wrapper around it

  @unit
  Scenario: The default phone factory preserves the SDK adapter's role
    Given the default Twilio agent factory builds an adapter for a phone target
    When the SDK's adapter reports its own role
    Then the role stays readable on the adapter the transport returns

  @unit
  Scenario: The default phone factory translates shouldRecord to the SDK's record option
    Given a phone target configured with shouldRecord for the call
    When the runner places the call through the default Twilio agent factory
    Then the SDK receives a record option carrying that value
    And the SDK never receives a shouldRecord option

  @unit
  Scenario: The default phone factory still delegates connect and disconnect to the SDK adapter
    Given the default Twilio agent factory builds an adapter for a phone target
    When the call connects and is later ended
    Then connecting and disconnecting are delegated to the SDK's own adapter

  # ---------------------------------------------------------------------------
  # Whole-call audio (#8014 — "they can listen to the whole call")
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A phone run's whole-call audio is resolved from the call's own trace
    Given a voice run whose trace spans carry the call's Twilio call sid
    When the whole-call audio is resolved
    Then it returns the Twilio handle read off the run's own trace

  @unit
  Scenario: A run against a voice agent with no call handle has no whole-call audio
    Given a voice run whose trace spans carry no call handle
    When the whole-call audio is resolved
    Then it returns nothing and the drawer shows no whole-call player

  @unit
  Scenario: VOICE_PUBLIC_BASE_URL is optional and falls back to the app's public base host
    Given VOICE_PUBLIC_BASE_URL is not set
    When the runner resolves the public base URL
    Then it uses the app's own public base host, and a set VOICE_PUBLIC_BASE_URL overrides it

  # ---------------------------------------------------------------------------
  # Phone run failures
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A phone run fails clearly when the project has no Twilio provider
    Given a voice agent with a phone-number target and no Twilio provider on the project
    When the simulation is started
    Then the run fails with the phone transport's missing-key message pointing at Settings > Model Providers
    And no call is placed

  @unit
  Scenario: A phone run fails clearly when Twilio refuses the call
    Given a phone target with a Twilio credential
    When Twilio rejects the outbound call
    Then the run fails with a message prefixed by the phone transport's connect-rejected prefix
    And the caller adapter is disconnected

  # ---------------------------------------------------------------------------
  # No browser call over phone
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A phone target has no browser call
    Given the phone transport runner
    When a browser session mint is attempted
    Then it fails because phone targets have no browser call

  @unit
  Scenario: A browser mint of a phone target is refused with a clear message
    Given the phone transport runner
    When a browser call of a phone target is attempted
    Then it fails because a phone call has no browser leg

  # ---------------------------------------------------------------------------
  # Drawer option gating
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The Phone number option appears only when a Twilio provider is configured
    Given the voice agent editor with no Twilio provider in the project
    Then the "Reached via" list offers no Phone number option, and a hint points at Settings > Model Providers
    When the project has a Twilio provider
    Then the "Reached via" list offers the Phone number option

  @integration
  Scenario: A phone target's drawer explains why Talk to it is off
    Given the voice agent editor open on a saved phone target
    Then the Talk to it button is disabled
    And its tooltip says browser calls are not available for phone targets
