Feature: Idempotency-Key on the control-plane creates

  # Retrying a create is the one retry that cannot be made safe by the caller
  # alone. A dropped connection after the write but before the response is
  # indistinguishable from a dropped request, and the obvious move, sending it
  # again, mints a second virtual key, budget, cache rule or webhook endpoint.
  # `Idempotency-Key` is how a caller says "these two requests are the same
  # request", and the receipt is what lets the second one answer with the
  # first one's response.
  #
  # The receipt protocol itself — the claim, its heartbeat, its takeover window
  # and the encrypted stored response — is
  # packages/api/src/rest/idempotency-ledger.ts, bound in
  # packages/api/src/rest/__tests__/idempotency-ledger.unit.test.ts. The API
  # process composes exactly one of it (apps/api/src/app/
  # api-idempotency.composition.ts) and hands the runner to every family that
  # accepts the header, which is what stops two takeover clocks racing over one
  # table. The REST scenarios are bound in
  # apps/api/src/app/__tests__/api-gateway-idempotency.integration.test.ts.

  As a backend that provisions gateway resources programmatically
  I want a create I can retry without checking first whether it landed
  So that a timeout costs me a retry rather than a duplicate I have to find
  and clean up.

  The four creates that accept the header are POST /api/gateway/v1/virtual-keys,
  /budgets and /cache-rules, and POST /api/webhooks/v1/endpoints. A key is
  unique within the tenancy its family authenticates at: the project for the
  gateway platform, the organization for the webhook platform. Receipts answer
  for 24 hours and store successful outcomes only, because a create that failed
  left nothing behind and is safe to run again.

  Background:
    Given a project "acme-prod" with a team and an organization above it
    And a credential that may create budgets, cache rules and virtual keys

  # ============================================================================
  # The unkeyed path is untouched
  # ============================================================================

  @integration @rest
  Scenario: A create sent without an idempotency key is unchanged
    When I send `POST /api/gateway/v1/budgets` with no Idempotency-Key
    Then the response status is 201
    And the response carries no X-Idempotent-Replay header
    And no receipt is stored for the project
    # Callers that never send the header must not start paying for a table.

  # ============================================================================
  # Replay
  # ============================================================================

  @integration @rest
  Scenario: Retrying a create with the same key replays the first response
    Given I created a budget with Idempotency-Key "order-4711" and got 201
    When I send the identical request again with Idempotency-Key "order-4711"
    Then the response status is 201
    And the response carries `X-Idempotent-Replay: true`
    And the body is byte-for-byte the body of the first response
    And only one budget exists
    # Byte-for-byte, not merely equivalent: the receipt column is `json` rather
    # than `jsonb` so that key order survives storage.

  @integration @rest
  Scenario: The other keyed creates take the same header
    Given I created a cache rule with Idempotency-Key "order-4711" and got 201
    When I send the identical request again with Idempotency-Key "order-4711"
    Then the response status is 201
    And the response carries `X-Idempotent-Replay: true`
    And only one cache rule exists

  @integration @rest @webhooks
  Scenario: An idempotency key on this family is unique within the organization
    Given I created a webhook endpoint with Idempotency-Key "order-4711" and got 201
    When I send the identical request again with Idempotency-Key "order-4711"
    Then the response status is 201
    And the response carries `X-Idempotent-Replay: true`
    And the replayed body carries the same signing secret as the first
    And the receipt is stored against the organization, not a project
    When I send a different body with Idempotency-Key "order-4711"
    Then the response status is 409 and the code is `idempotency_error`
    # The secret is minted once and stored only as a hash, so a replay that
    # withheld it would hand back an endpoint nobody can verify.

  # ============================================================================
  # Refusals
  # ============================================================================

  @unit
  Scenario: One key cannot answer for two different creates
    Given a virtual key create and a cache rule create in the same project
    When the same key and the same body are sent to both
    Then the second is refused rather than answered with the first response
    # The gateway platform's creates all authenticate at the project, so one
    # key lands on one receipt whichever create sent it. Which create it was
    # is therefore part of the request fingerprint, and two creates that
    # happen to validate to the same body do not replay each other.

  @integration @rest
  Scenario: Reusing a key with a different body is refused
    Given I created a budget with Idempotency-Key "order-4711" and got 201
    When I send a request with Idempotency-Key "order-4711" and a changed limit
    Then the response status is 409 and the code is `idempotency_error`
    And `meta.reason` is "body_mismatch"
    And no second budget was created

  @integration @rest
  Scenario: A retry sent while the original is still running is refused
    Given a receipt for Idempotency-Key "order-4711" that is claimed but not yet answered
    And the request holding that claim is still reporting itself alive
    When I send the same request again with Idempotency-Key "order-4711"
    Then the response status is 409 and the code is `idempotency_error`
    And `meta.reason` is "in_progress"
    And nothing new was created
    # The unique index on (scopeId, key) is what serialises the two retries;
    # without the claim going in first, both would find the key free.

  @integration @rest
  Scenario: A slow original that is still reporting alive keeps its claim
    Given a receipt for Idempotency-Key "order-4711" claimed five minutes ago
    And the request holding that claim reported itself alive a moment ago
    When I send the same request again with Idempotency-Key "order-4711"
    Then the response status is 409 and the code is `idempotency_error`
    And `meta.reason` is "in_progress"
    And nothing new was created
    # A request waiting on a row lock or a saturated connection pool is slow,
    # not dead, and it is still going to write its resource. Taking the key
    # off it on age alone is what makes one key stand for two resources, and
    # it does so precisely when the platform is least able to absorb it.

  @unit
  Scenario: Takeover turns on the last beat, not on the claim's age
    Given a claim made long enough ago to be past any fixed window
    When it reported itself alive within the tolerance
    Then it is not treated as abandoned
    # Stated as its own scenario because every age threshold has this same
    # failure at its own horizon, so the rule has to be liveness or it is
    # nothing.

  @integration @rest
  Scenario: An unusable idempotency key is refused before anything is created
    When I send `POST /api/gateway/v1/budgets` with Idempotency-Key "short"
    Then the response status is 400 and the code is `validation_error`
    And `meta.target` is "header"
    And no budget was created
    # Refused rather than ignored: a caller who sent a key believes its retry
    # is protected, and would otherwise learn otherwise from a duplicate.

  # ============================================================================
  # Recovery
  # ============================================================================

  @integration @rest
  Scenario: A claim that stopped reporting itself alive is taken over
    Given a receipt for Idempotency-Key "order-4711" that is claimed but not yet answered
    And the request holding that claim stopped reporting itself alive
    When I send the same request again with Idempotency-Key "order-4711"
    Then the response status is 201
    And the receipt now holds the new response under a new claim
    And exactly one budget exists
    # Without this the key stays locked for its full 24 hours whenever a
    # process dies between claiming the key and storing its answer, and the
    # caller can never complete the create it was trying to make. Missed beats
    # rather than elapsed time, so the key recovers in seconds when the holder
    # really is gone and never while it is merely slow.

  @integration @rest
  Scenario: A replaced request cannot overwrite the receipt that replaced it
    Given a claim taken over while the request holding it was still running
    When that request finishes and stores its response
    Then the receipt still holds the response of the claim that replaced it
    And the attempt is logged as a key that may stand for two resources
    # Defense in depth behind the liveness rule: a takeover of a genuinely
    # dead request can still race a process that comes back. Every write a
    # claim holder makes names its own claim, so the loser writes nothing and
    # says so, rather than silently overwriting the winner's receipt.

  @integration @rest
  Scenario: An expired receipt lets the key be used again
    Given a receipt for Idempotency-Key "order-4711" whose 24 hours have elapsed
    When I send the same request again with Idempotency-Key "order-4711"
    Then the response status is 201
    And the response carries no X-Idempotent-Replay header
    And the lapsed receipt was replaced rather than left behind

  @integration @rest
  Scenario: A receipt that no longer decrypts lets the key be used again
    Given a receipt for Idempotency-Key "order-4711" written before CREDENTIALS_SECRET was rotated
    When I send the same request again with Idempotency-Key "order-4711"
    Then the response status is 201
    And the response carries no X-Idempotent-Replay header
    And the unreadable receipt was replaced rather than left behind
    # Stored bodies are encrypted, so a rotation inside the 24 hours leaves
    # rows that are authentic and no longer readable. Handled exactly like
    # expiry, because refusing would leave the caller with a create it can
    # never make and a key it cannot reuse.
