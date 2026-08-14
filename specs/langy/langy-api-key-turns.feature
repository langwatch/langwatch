Feature: Starting Langy conversations with a project API key
  As an operator automating against LangWatch
  I want to drive Langy over HTTP with a project API key
  So that scripts and CI can use the assistant without a browser session
  or a human's password

  # The access decision stays per user (ADR-033): the key names its owner, and
  # that owner is judged by the same gate the browser surface uses. The key
  # authenticates the caller; it never names the actor.

  # ---------------------------------------------------------------------------
  # Identity bridge — key owner resolved through the Langy access gate
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A key owned by a user with Langy access resolves to that user
    Given a project API key issued to a user who is in the Langy cohort
    When the Langy surface resolves the identity behind the key
    Then the resolution succeeds
    And the resolved actor is the key's owner

  @unit
  Scenario: A key owned by a user without Langy access is refused
    Given a project API key issued to a user who is not in the Langy cohort
    When the Langy surface resolves the identity behind the key
    Then the resolution is refused for lack of access

  @unit
  Scenario: Access lost after issuance refuses the same unedited key
    Given a project API key whose owner is in the Langy cohort
    And the identity behind the key resolves successfully
    When that owner is removed from the Langy cohort
    Then resolving the identity behind the same unedited key is refused

  @unit
  Scenario: A key owned by no user is refused rather than evaluated on project alone
    Given a project API key that is not owned by any individual user
    When the Langy surface resolves the identity behind the key
    Then the resolution is refused as unowned
    And the Langy access gate is not consulted

  @unit
  Scenario: The actor is never taken from the request payload
    Given a project API key issued to one user
    And a request payload naming a different user as the actor
    When the Langy surface resolves the identity behind the key
    Then the resolved actor is the key's owner
    And the user named in the payload is ignored

  @unit
  Scenario: The acting identity is loaded from the owner's record, not invented
    Given a project API key owned by a user with a name and email on file
    When the surface builds the acting identity for a turn
    Then the identity carries that user's own name and email
    And no placeholder actor is substituted

  @unit
  Scenario: A key whose owning user no longer exists is refused
    Given a project API key whose owning user record has been deleted
    When the surface builds the acting identity for a turn
    Then the turn is refused
    And no stand-in actor is used in the owner's place

  @unit
  Scenario: The key-authed surface is switched off by default
    Given a deployment that has not opted into key-initiated Langy turns
    When the rollback switch for the surface is read
    Then the surface is closed
    And the switch is independent of the flag that opens Langy itself

  # ---------------------------------------------------------------------------
  # Capability — turn start, continue, streaming
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: A key with langy:create starts a conversation without a browser session
    Given a project API key carrying "langy:create"
    And no browser session and no user password are supplied
    When the caller starts a Langy conversation over HTTP
    Then the response carries a conversation identifier

  @integration @unimplemented
  Scenario: The same key continues an existing conversation
    Given a conversation started by a project API key
    When the caller sends a further message on that conversation with the same key
    Then the response carries the assistant's output for that message

  @integration @unimplemented
  Scenario: The caller observes incremental events before the turn completes
    Given a conversation started by a project API key
    When the caller starts a turn and reads the event stream
    Then at least two distinct events arrive before the turn completes

  # Synchronous delivery (RFC 7240 `Prefer: wait=<seconds>`). A plain HTTP
  # client — a script, CI, or a scenario HTTP agent — has no way to consume the
  # 202-then-stream contract, so the turn route itself can hold the connection
  # until the turn settles on the durable fold and answer with the assistant's
  # output in the body.

  @unit
  Scenario: A caller preferring to wait receives the assistant's output synchronously
    Given an accepted turn started with a project API key
    And the request carries a wait preference
    When the turn settles with an assistant response
    Then the response is synchronous and carries the assistant's output for that turn
    And the response declares which preference was applied

  @unit
  Scenario: A wait is satisfied only by the turn this request started
    Given a request waiting on its own accepted turn
    When a different turn on the same conversation settles first
    Then the wait continues until this request's own turn settles

  @unit
  Scenario: A failed turn settles the wait as a domain outcome, not a transport refusal
    Given a request waiting on its own accepted turn
    When the turn fails
    Then the response is successful at the transport level
    And it carries the turn's failed status and error with no assistant reply

  @unit
  Scenario: A plain-text message is accepted without the parts structure
    Given a caller whose message shape is plain role-and-text
    When it starts a turn with a project API key
    Then the message is accepted as a single text part
    And a message carrying both shapes keeps its structured parts

  @unit
  Scenario: An expired wait degrades to the asynchronous acceptance
    Given a request waiting on its own accepted turn
    When the wait window expires before the turn settles
    Then the response is the same asynchronous acceptance an unadorned request receives
    And no applied preference is declared

  # ---------------------------------------------------------------------------
  # Failure modes
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: A read-only Langy key may not start a turn
    Given a project API key carrying "langy:view" but not "langy:create"
    When the caller starts a Langy conversation over HTTP
    Then the request is refused with 403
    And no worker is provisioned for that request

  @integration @unimplemented
  Scenario: A revoked or malformed key is refused before Langy runs
    Given a revoked or malformed project API key
    When the caller starts a Langy conversation over HTTP
    Then the request is refused with 401
    And the Langy access gate is never consulted for that request

  @integration @unimplemented
  Scenario: A second concurrent turn on one conversation is refused, not provisioned
    Given a conversation with a turn already in progress
    When a second turn-start arrives for the same conversation
    Then the second request receives the documented single-turn-in-progress refusal
    And exactly one worker exists for that conversation

  # ---------------------------------------------------------------------------
  # Downstream / ripple
  # ---------------------------------------------------------------------------

  @e2e @unimplemented
  Scenario: Browser-session Langy behaviour is unchanged
    Given the key-authed Langy surface is deployed
    When the existing browser Langy scenario suite runs unmodified
    Then it passes

  @integration @unimplemented
  Scenario: A key-initiated turn acts only on its owner's GitHub identity
    Given a conversation started by a project API key
    When the turn reaches the GitHub capability
    Then the identity used is the key's owner
    And no other user's GitHub credentials are reachable

  # ---------------------------------------------------------------------------
  # Regression surface — the internal relay plane stays separate
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: The internal shared secret is not a credential on the public surface
    Given the Langy internal shared secret
    When it is presented to the key-authed Langy route
    Then the request is refused with 401

  @integration @unimplemented
  Scenario: Internal Langy routes still require the internal secret
    Given the internal Langy relay routes
    When a request arrives without the internal shared secret
    Then it is refused

  # ---------------------------------------------------------------------------
  # Rollback
  # ---------------------------------------------------------------------------

  # Being switched off is not enough on its own. While the surface is off it has
  # to be INDISTINGUISHABLE from a route that was never built: any answer other
  # than "no such route" — a permission denial, an error envelope carrying a
  # trace id — confirms the feature is there to a caller who was only guessing.
  # Both scenarios below are about that, and both are easy to break by moving a
  # few lines, so they are pinned at unit level rather than left to integration.
  @unit
  Scenario: A switched-off surface answers exactly as a route that does not exist
    Given the key-authed Langy surface is disabled for my project
    When I start a turn with a valid project API key
    Then the answer is identical to what an unrouted path returns
    And it carries no error envelope, code or trace id that would confirm the surface

  @unit
  Scenario: The rollback switch is checked before the caller's permissions
    Given the key-authed Langy surface is disabled for my project
    And my key lacks the permission a turn requires
    When I start a turn
    Then I am told there is no such route, not that I lack permission
    And my permissions are never checked at all

  @integration @unimplemented
  Scenario: The key-authed surface can be switched off without touching browser Langy
    Given the key-authed Langy surface is disabled
    When a caller starts a Langy conversation with a project API key
    Then the request is refused
    And the browser Langy scenario suite still passes

# --- AC Coverage Map ---
# AC 1:  "key with langy:create starts a conversation, receives an identifier"
#          -> Scenario: A key with langy:create starts a conversation without a browser session
# AC 2:  "same caller continues the conversation, receives assistant output"
#          -> Scenario: The same key continues an existing conversation
#          (supporting, unit level: A caller preferring to wait receives the
#           assistant's output synchronously / A wait is satisfied only by the
#           turn this request started / A failed turn settles the wait as a
#           domain outcome, not a transport refusal / An expired wait degrades
#           to the asynchronous acceptance — the `Prefer: wait` delivery path
#           for that output; A plain-text message is accepted without the
#           parts structure — the wire shape a generic client can produce)
# AC 3:  "incremental turn events before the turn completes, at least two"
#          -> Scenario: The caller observes incremental events before the turn completes
# AC 4:  "langy:view but not langy:create refused 403, no worker provisioned"
#          -> Scenario: A read-only Langy key may not start a turn
# AC 5:  "revoked or malformed key refused 401 before any Langy code executes"
#          -> Scenario: A revoked or malformed key is refused before Langy runs
# AC 6:  "apiKeyUserId no longer passes the access gate -> 403 without editing the key"
#          -> Scenario: Access lost after issuance refuses the same unedited key
#          -> Scenario: A key owned by a user without Langy access is refused
#          (supporting: A key owned by a user with Langy access resolves to that user)
# AC 7:  "two concurrent turn-starts -> documented refusal for the loser, one worker"
#          -> Scenario: A second concurrent turn on one conversation is refused, not provisioned
# AC 8:  "browser-session Langy unchanged, existing e2e suite passes unmodified"
#          -> Scenario: Browser-session Langy behaviour is unchanged
# AC 9:  "never acts on another user's GitHub credentials; capability per phase-1 decision"
#          -> Scenario: A key-initiated turn acts only on its owner's GitHub identity
#          (supporting: The actor is never taken from the request payload)
#          NOTE: the capability-scope half of AC 9 — whether a key-initiated turn
#          may reach the GitHub capability at all — is the open phase-1 decision.
#          The scenario above pins the identity half, which holds either way.
# AC 10: "public surface rejects the internal shared secret; internal routes still require it"
#          -> Scenario: The internal shared secret is not a credential on the public surface
#          -> Scenario: Internal Langy routes still require the internal secret
# AC 11: "surface can be disabled without affecting browser Langy"
#          -> Scenario: The key-authed surface can be switched off without touching browser Langy
#
# Scenarios tagged @unimplemented are tracked gaps for later slices of #6821.
# This slice implements and binds the identity bridge only.
