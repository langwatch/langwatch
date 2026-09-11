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
    Given a phone runner that requests recording for the call
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

  @unit
  Scenario: A phone call's scenario child never binds the worker's media port
    Given the parent worker's own VOICE_WS_PORT is set in the environment
    When the phone transport builds the SDK adapter
    Then the adapter is always given an OS-assigned port, never the worker's own port

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
  # Per-call nonce handoff (the phone transport parent/child IPC race)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A phone call fails loudly when the parent never acknowledges the nonce
    Given a phone target with a valid Twilio credential
    When the run registers the call's nonce and the parent process never acknowledges it
    Then connect waits on the registration and never places the call

  @unit
  Scenario: A phone call fails loudly when the parent refuses the nonce
    Given a phone target with a valid Twilio credential
    When the parent process refuses to register the call's nonce
    Then the refusal surfaces as the run's error and no call is placed
    And the caller adapter is disconnected

  @unit
  Scenario: A phone call fails fast when the listener refuses the socket mid-dial
    Given a phone call whose nonce was registered and dialling has started
    When the media listener refuses the upgrade because the nonce has expired
    Then connect fails immediately with the refusal reason instead of waiting out the call
    And the caller adapter is disconnected

  @unit
  Scenario: A phone call registers its stream nonce with the parent before dialling
    Given a phone transport about to dial
    When it connects
    Then it registers the call's nonce and awaits the parent's ack before placeCall runs

  @unit
  Scenario: A registered nonce lets the real Twilio upgrade through
    Given the child registered its nonce with the parent
    When Twilio's dial-back arrives on that nonce
    Then the upgrade routes to a handoff, not a 403

  @unit
  Scenario: An unregistered nonce is refused 403
    Given the child never registered its nonce with the parent
    When Twilio's dial-back arrives on that nonce
    Then the upgrade is refused as an unknown nonce

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

  # ---------------------------------------------------------------------------
  # Worker mode and media listener (slice 3)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The voice worker reads its infrastructure environment variables
    Given the voice worker environment with no variables set
    When the worker environment is read
    Then the websocket port defaults to 3300 and no public base URL is set

  @unit
  Scenario: A public base URL must be an https origin
    Given a public base URL is configured
    When the worker environment is read
    Then an https origin is accepted and reported, and a non-https origin is rejected

  @unit
  Scenario: A voice worker opens a quick tunnel when no public base URL is configured
    Given no public base URL is configured and the tunnel fallback is left on
    When the worker environment is read and its public URL is resolved
    Then it does not fail, opens a cloudflared quick tunnel on the websocket port
    And it waits until the tunnel's host resolves before treating it as ready

  @unit
  Scenario: A voice worker's public URL tunnel fails fast when it never becomes reachable
    Given a cloudflared quick tunnel has been opened
    When its host never resolves before the readiness timeout elapses
    Then the tunnel is closed and the worker fails, naming the tunnel URL and the timeout

  @unit
  Scenario: A voice worker's quick tunnel is closed on worker shutdown
    Given a cloudflared quick tunnel is open and ready
    When the worker closes it on shutdown
    Then the underlying tunnel's own close is called

  @unit
  Scenario: An explicit public base URL always wins over the tunnel fallback
    Given an explicit https public base URL is configured and the tunnel fallback is on
    When the worker environment is read
    Then the explicit public base URL is reported and the tunnel is never opened

  @unit
  Scenario: A worker's own voice boot failure does not take the worker down
    Given a worker whose voice tunnel or media listener boot step fails
    When the worker boots
    Then the failure is logged and the rest of the worker boots normally

  @unit
  Scenario: A worker's boot plan always includes the voice media listener
    Given any worker's boot environment
    When the worker boot plan is resolved
    Then it boots the voice media listener alongside every other subsystem

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
  Scenario: A dial-back arriving after ring delay is still accepted
    Given a nonce registered to a child
    When Twilio's dial-back arrives after the callee's ring delay, any time up to the SDK's own connect-wait deadline
    Then the nonce is still consumed successfully

  @unit
  Scenario: A nonce that outlives the SDK's own wait window is still refused
    Given a nonce registered to a child
    When it outlives even the SDK's own connect-wait window
    Then it is still refused as expired

  @unit
  Scenario: The media listener hands a valid call's socket to its scenario child
    Given the voice media listener is running with a nonce registered to a child
    When an upgrade arrives on that nonce's media path
    Then the raw socket is handed to the registered child

  @unit
  Scenario: The child feeds a handed-off Twilio socket into its own adapter
    Given the parent has handed off Twilio's media socket to the child over IPC
    When the child receives it
    Then it forwards the received socket into the adapter's own upgrade handler

  @integration
  Scenario: A handed-off media socket arrives at the scenario child process
    Given a real scenario child process with an inter-process channel
    And a nonce registered to that child
    When an upgrade arrives on that nonce's media path
    Then the child receives the socket handle and the bytes read during the upgrade
