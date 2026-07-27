Feature: Mobile ops API
  As an operator carrying a phone instead of a laptop
  I want the ops procedures reachable without a browser session
  So that a native client can monitor the platform end to end

  Context: every ops surface is a tRPC procedure on `opsRouter`, authenticated by
  a session cookie at `/api/trpc`. A native app cannot hold that cookie. Rather
  than mirror those procedures behind a second hand-written API — two
  implementations of the same query, drifting the moment either is edited — this
  adds a SECOND MOUNT of the SAME router at `/api/mobile/trpc`, authenticated by
  the RFC 8628 device-flow access token the CLI already mints.

  The mount serves `mobileRouter`, which is the ops namespace and nothing else.
  Device tokens exist today for the CLI, where they unlock a handful of explicit
  endpoints; pointing them at the whole app router would silently turn every
  token already in a developer's keyring into a credential for the entire
  product API. Scoping the router bounds what a lost phone reaches to what an
  operator can already read on the ops page.

  Scoping the ROUTER is not scoping the PERMISSIONS: every procedure still runs
  its own `ops:view` / `ops:manage` check, so a non-operator holding a valid
  token is refused exactly as they would be on the web. Nor is it scoping the
  VERBS — the mount serves the ops namespace whole, mutations included, so the
  app can unblock, drain, redrive, replay and reclaim through the same
  procedures the web console calls. What keeps a phone safe is the shape of each
  action in the client, not a second permission model here.

  # ---------------------------------------------------------------------------
  # Authentication
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A request without credentials is refused
    Given a client with no access token
    When it calls any ops procedure on the mobile mount
    Then the call is refused as unauthorized
    And no ops service is reached

  @integration
  Scenario: A session cookie is not accepted on this mount
    Given a client presenting only a browser session cookie
    When it calls an ops procedure on the mobile mount
    Then the call is refused as unauthorized

  @integration
  Scenario: A device-flow access token authenticates the caller
    Given an operator has completed the device authorization flow
    And the client holds the issued access token
    When it calls an ops procedure with that token as a bearer credential
    Then the call succeeds
    And it returns the same data the web surface would return

  @integration
  Scenario: An expired access token is refused
    Given the client holds an access token whose lifetime has passed
    When it calls an ops procedure
    Then the call is refused as unauthorized
    And the stored token record is discarded

  @integration
  Scenario: A token naming a user who no longer exists is refused
    Given the client holds a token minted for a since-deleted account
    When it calls an ops procedure
    Then the call is refused as unauthorized

  @integration
  Scenario: The synthesized session expires with the token behind it
    Given a client holding a valid access token
    When a procedure reads the session
    Then the session's expiry is the token's expiry
    And the session carries no impersonator, because a device token acts as one identity

  # ---------------------------------------------------------------------------
  # Authorization
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A signed-in user without ops access is refused
    Given an authenticated user who is not a platform operator
    When they call an ops procedure with a valid token
    Then the call is refused as forbidden
    And the refusal is recorded in the audit trail

  @integration
  Scenario: The scope probe answers instead of failing for a non-operator
    Given an authenticated user who is not a platform operator
    When the client calls the scope procedure
    Then the call succeeds
    And it reports that the user has no ops scope
    And the app can explain the situation rather than showing an error

  # ---------------------------------------------------------------------------
  # What the mount exposes
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The mobile router carries the ops namespace and nothing else
    When the mobile router is inspected
    Then every procedure on it belongs to the ops namespace
    And no other part of the app router is reachable with a device token

  @unit
  Scenario: The mobile router exposes the very same procedures as the web
    When the mobile router's ops procedures are compared with the web ops router
    Then the two sets are identical
    And there is one implementation of each ops query, not two

  @unit
  Scenario: The mount is registered with an access policy
    When the API router is composed
    Then the mobile tRPC routes appear in the route registry with a policy

  @integration
  Scenario: Responses use the transformer the client is configured for
    When a procedure returns data on the mobile mount
    Then the response is encoded the same way the web mount encodes it
    And a client configured with the shared transformer decodes it unchanged

  # ---------------------------------------------------------------------------
  # Procedures added for the mobile client
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A group's jobs can be read without their payloads
    Given a group whose queued jobs carry customer payloads
    When the payload-free job summaries are requested
    Then each job reports its id, its score and the size of its payload
    And each job reports the top-level keys of its payload
    And no payload contents are returned

  @unit
  Scenario: Reading job payloads stays available to the web surface
    Given the same group
    When the full job listing is requested
    Then the payloads are returned as before
    And the two procedures are separate, so payloads never cross the wire by omission

  @unit
  Scenario: The Foundry preset catalog is readable over the API
    When the foundry preset catalog is requested
    Then every built-in preset is returned with its name and description
    And each preset reports the span tree it would generate
    And no span carries message bodies or attributes

  @unit
  Scenario: The Foundry catalog is not restated on the client
    When a preset is edited in the web Foundry
    Then the catalog the API serves changes with it
    And no second copy of the presets exists to drift

  # ---------------------------------------------------------------------------
  # Mutations
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A mutation runs under the caller's own ops permission
    Given an operator holding a device token
    When they call a procedure that mutates a queue
    Then the procedure's own ops:manage check decides, exactly as on the web

  @integration
  Scenario: A mutation from a non-operator is refused
    Given a token for an account that is not a platform operator
    When they call a procedure that mutates a queue
    Then the call is refused as forbidden
    And nothing is mutated

  @integration
  Scenario: Every mutation is attributed to the operator who made it
    Given an operator holding a device token
    When they run any mutation on this mount
    Then the audit trail records it against their account
    And the record is indistinguishable in kind from the same action taken on the web

  @integration
  Scenario: A destructive payload-store action still needs its typed confirmation
    Given an operator holding a device token
    When they run a real sweep or delete a payload without the confirmation
    Then the call is refused
    Because the server checks the confirmation itself, so a client that skipped
      its own prompt gains nothing
