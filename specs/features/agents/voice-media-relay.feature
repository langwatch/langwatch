Feature: Voice agents: a self-hosted install relays phone media through the LangWatch gateway
  As an operator of a self-hosted install that Twilio cannot reach
  I want my worker to dial out to the LangWatch gateway and have Twilio dial the gateway
  So that phone runs work with one outbound rule and no inbound path to my deployment

  # @see https://github.com/langwatch/tasks/issues/1002 (slice 4c)
  # The gateway side is specs/ai-gateway/voice-media-relay.feature. With VOICE_MEDIA_RELAY=true
  # the worker opens GET /v1/voice/relay with its Connect license token and instance id, dials
  # Twilio with the relay's stream URL, and, when the gateway says Twilio joined, bridges the
  # relay into the same claim a direct call goes through (specs/features/agents/voice-media-claim.feature):
  # the pending call must exist, Twilio's signature must be valid for the stream URL Twilio was
  # given, and only the winning claim spawns the child. Synthetic signatures only.

  # ---------------------------------------------------------------------------
  # Configuration
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Phone media goes through the gateway relay only when VOICE_MEDIA_RELAY is true
    Given the worker environment
    When VOICE_MEDIA_RELAY is unset, "1" or "TRUE"
    Then the relay is off, off, and on

  # ---------------------------------------------------------------------------
  # Dialling through a relay
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An install without a Connect license credential opens no relay and dials nothing
    Given the install has no Connect upstream
    When a run's call is placed through the relay
    Then no relay is opened, Twilio is not dialled and the answer is "no-relay-credential"

  @unit
  Scenario: A refused relay open dials nothing and reports the gateway's refusal
    Given the gateway refuses to open a relay with 403 "voice_relay_license_required"
    When a run's call is placed through the relay
    Then Twilio is not dialled and the answer carries the status and the code

  @unit
  Scenario: The call is dialled with the relay's stream URL
    Given the install has a Connect upstream
    When a run's call is placed through the relay
    Then the relay is opened with that license token and instance id
    And Twilio is dialled with the relay's stream URL and the run's nonce

  @unit
  Scenario: A relay whose call is not dialled is closed
    Given the run's call was already dialled
    When the call is placed through the relay again
    Then the answer is "already-dialed" and the new relay is closed

  @unit
  Scenario: A relay that ends before Twilio joins bridges nothing
    Given a call placed through a relay
    When the gateway ends the relay with 4408 before Twilio joins
    Then nothing is bridged and the call stays pending for the claim deadline

  @unit
  Scenario: Twilio joining the relay bridges it with Twilio's signature
    Given a call placed through a relay
    When Twilio joins the relay with a signature
    Then the relay is bridged for the run's call with that signature

  # ---------------------------------------------------------------------------
  # The relay client
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The relay is opened with the install's license token and instance id
    Given a gateway that answers a relay open with a ready frame
    When the worker opens a relay
    Then the upgrade carries "Authorization: Bearer <token>" and "X-LangWatch-Instance"
    And the relay's stream URL is the gateway's wss origin and the ready frame's stream path

  @integration
  Scenario: A refused relay open reports the gateway's status and error code
    Given a gateway that refuses the open with 403 "voice_relay_license_required"
    When the worker opens a relay
    Then the open is refused with status 403 and code "voice_relay_license_required"

  @integration
  Scenario: A relay that does not start with a ready frame is refused
    Given a gateway that answers the upgrade with a frame that is not "langwatch.relay.ready"
    When the worker opens a relay
    Then the open is refused as a protocol error

  @integration
  Scenario: Twilio's frames reach the worker after the joined notice, in order
    Given an open relay
    When the gateway sends "langwatch.relay.joined" with a signature, then Twilio's frames
    Then the relay reports the join with that signature
    And every frame reaches the worker in order, including frames sent before it listened

  @integration
  Scenario: A transient socket error after open does not terminate an active relay
    Given an open relay with Twilio joined
    When the relay's socket reports an error after it opened
    Then the relay keeps carrying frames between the worker and Twilio

  # ---------------------------------------------------------------------------
  # Through the claim, end to end
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A relayed call with a valid signature is claimed and its media reaches the child
    Given a call placed through a relay on a gateway stand-in
    When a Twilio-shaped client joins the relay with a signature valid for the stream URL
    Then the call is claimed, a child is spawned and the child's answer reaches Twilio

  @integration
  Scenario: A relayed call with a bad signature is refused and leaves the call pending
    Given a call placed through a relay on a gateway stand-in
    When a Twilio-shaped client joins the relay with a signature made with another auth token
    Then no child is spawned, Twilio's socket is closed and the call can still be peeked

  @integration
  Scenario: Twilio hanging up ends the child's media socket
    Given a relayed call that is claimed and bridged
    When the Twilio-shaped client closes its socket
    Then the child's socket closes and the child exits
