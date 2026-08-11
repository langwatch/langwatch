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
