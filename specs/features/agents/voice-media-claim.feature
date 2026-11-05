Feature: Voice agents: the pod that Twilio dials claims the call
  As an operator running several workers behind one public address
  I want the worker that receives Twilio's media upgrade to claim the pending call and spawn its child
  So that any worker can take the call, a forged upgrade cannot spend it, and a cancel always ends it

  # @see https://github.com/langwatch/tasks/issues/1002
  # Slice 2 replaces the per-worker nonce registry with a shared pending-call record.
  # The upgrade path is /twilio/<scenarioRunId>/<nonce>. The door checks, in order: the pending
  # call exists, Twilio's signature is valid, the claim wins. Only then does it spawn the child.
  # A bad signature never spends the nonce. Synthetic signatures only: no real Twilio traffic.

  # ---------------------------------------------------------------------------
  # The pending-call record
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A pending call is peeked without being consumed
    Given a stored pending call
    When it is peeked twice
    Then both peeks find the call

  @unit
  Scenario: A pending call is claimed once
    Given a stored pending call
    When it is claimed twice
    Then the first claim wins and the second answers unknown

  @unit
  Scenario: A claim with the wrong nonce finds nothing
    Given a stored pending call
    When it is claimed with another nonce
    Then the claim answers unknown and the call stays pending

  @unit
  Scenario: A cancelled run is never claimed
    Given a stored pending call
    When the run is cancelled
    Then a claim answers cancelled
    And storing another call for the run is refused as cancelled

  @unit
  Scenario: A claimed run cannot be put again
    Given a claimed run with a call SID
    When another call is put for the run
    Then the put is refused as claimed
    And the run keeps its call SID

  @unit
  Scenario: A cancel reports the state the run was in
    Given runs that are pending, claimed with a call SID, and unknown
    When each is cancelled
    Then each answers pending, claimed with its call SID, and absent

  @unit
  Scenario: A cancel before the call SID is known still ends the call
    Given a stored pending call whose call SID is not known yet
    When the run is cancelled and the SID is then attached
    Then attaching the SID answers cancelled so the caller hangs the call up itself

  @unit
  Scenario: A cancelled run's tombstone lapses
    Given a cancelled run
    When the tombstone lifetime passes
    Then the run reads as absent again

  @unit
  Scenario: A pending call lapses at its lifetime
    Given a stored pending call
    When its lifetime passes
    Then it is no longer found and cannot be claimed

  @integration
  Scenario: Redis hands a pending call to exactly one of two racing claims
    Given a pending call stored in Redis
    When two claims race
    Then exactly one wins

  @integration
  Scenario: Redis keeps a pending call for its lifetime and no longer
    Given a pending call stored in Redis with a lifetime
    When the key's remaining time is read
    Then it is positive and no longer than the lifetime

  @integration
  Scenario: Both keys of a run live in one cluster slot
    Given a run with a pending call, a call SID and a claim
    When the Redis keys written for the run are listed
    Then every key carries the run's hash tag
    And every key hashes to the same cluster slot

  # ---------------------------------------------------------------------------
  # Twilio's signature
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The media signature is Twilio's HMAC-SHA1 of the stream URL
    Given a Twilio auth token and the wss stream URL the call was placed with
    When the upgrade's signature is checked
    Then the base64 HMAC-SHA1 of that URL under that token is accepted

  @unit
  Scenario: The signature is accepted for any spelling Twilio may have signed
    Given a signature over the https spelling, with a trailing slash, or with the default port
    When the signature is checked against the wss stream URL
    Then every such spelling is accepted

  @unit
  Scenario: A signature under another account's token is refused
    Given a signature made with a different auth token
    When the signature is checked
    Then it is refused

  @unit
  Scenario: A signature for another host's URL is refused
    Given a signature made for a stream URL on another host
    When the signature is checked
    Then it is refused

  @unit
  Scenario: A missing or empty signature is refused
    Given no signature header, or an empty one
    When the signature is checked
    Then it is refused

  # ---------------------------------------------------------------------------
  # The door
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A valid upgrade claims the call and hands the socket to a fresh child
    Given a pending call and an upgrade signed for its stream URL
    When the upgrade arrives
    Then the upgrade is accepted and the spawned child echoes media

  @integration
  Scenario: An upgrade for an unknown call is refused
    Given no pending call for the path
    When the upgrade arrives
    Then it is refused with 403 and no child is spawned

  @integration
  Scenario: A bad signature leaves the nonce claimable
    Given a pending call
    When an upgrade arrives with a wrong signature
    Then it is refused with 403 and no child is spawned
    And the call is still pending
    And a correctly signed upgrade then claims it

  @integration
  Scenario: An upgrade without a signature is refused and leaves the call pending
    Given a pending call
    When an upgrade arrives with no signature header
    Then it is refused with 403 and the call is still pending

  @integration
  Scenario: A used nonce is refused the second time
    Given a call already claimed by a signed upgrade
    When a second signed upgrade arrives
    Then it is refused with 403 and only one child was spawned

  @integration
  Scenario: A cancelled run is refused at the door
    Given a pending call whose run was then cancelled
    When a signed upgrade arrives
    Then it is refused with 403 and no child is spawned

  @integration
  Scenario: A cancellation after the claim kills the child
    Given a claimed call with a running child
    When the run's cancellation is broadcast
    Then the child exits

  @integration
  Scenario: A failed handoff kills the child and closes the socket
    Given a claimed call whose child cannot take the socket
    When the door hands the socket over
    Then the child exits and the socket is closed

  @integration
  Scenario: A second upgrade for a run this pod holds is refused
    Given two upgrades for the same call arrive back to back on one pod
    When the door handles both
    Then one child is spawned and the other upgrade is refused with 403
    And a cancellation for the run still kills that child

  @integration
  Scenario: A cancellation for another run leaves the child alone
    Given a claimed call with a running child
    When another run's cancellation is broadcast
    Then the child keeps running

  @integration
  Scenario: Connected and start frames sent with the upgrade reach the child in order
    Given a pending call
    When Twilio sends connected and start in the same write as the upgrade request
    Then the child receives both frames in order

  # ---------------------------------------------------------------------------
  # Cancelling a call
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A cancel before the claim ends the call when its SID is known
    Given a pending call with a known call SID
    When the run is cancelled
    Then the call is ended at Twilio

  @unit
  Scenario: A cancel after the claim ends the call
    Given a claimed call with a known call SID
    When the run is cancelled
    Then the call is ended at Twilio

  @unit
  Scenario: A cancel with no call to end ends nothing
    Given a run with no pending call
    When the run is cancelled
    Then no call is ended

  @unit
  Scenario: A cancel before the call SID is known ends nothing yet
    Given a pending call whose SID is not known
    When the run is cancelled
    Then no call is ended
    And attaching the SID afterwards answers cancelled
