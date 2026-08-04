Feature: Idempotency-Key on the control-plane creates

  # Retrying a create is the one retry that cannot be made safe by the caller
  # alone. A dropped connection after the write but before the response is
  # indistinguishable from a dropped request, and the obvious move, sending it
  # again, mints a second virtual key, budget, cache rule or webhook endpoint.
  # `Idempotency-Key` is how a caller says "these two requests are the same
  # request", and the receipt is what lets the second one answer with the
  # first one's response.
  #
  # Bound scenarios run in
  # langwatch/src/app/api/gateway-platform/__tests__/ and
  # langwatch/src/app/api/webhooks/__tests__/ against the real Hono apps and
  # real Postgres.

  As a backend provisioning gateway resources programmatically
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
    Given I created a budget with Idempotency-Key "k" and got 201
    When I send the identical request again with Idempotency-Key "k"
    Then the response status is 201
    And the response carries `X-Idempotent-Replay: true`
    And the body is byte-for-byte the body of the first response
    And only one budget exists
    # Byte-for-byte, not merely equivalent: the receipt column is `json` rather
    # than `jsonb` so that key order survives storage.

  @integration @rest
  Scenario: The other keyed creates take the same header
    Given I created a cache rule with Idempotency-Key "k" and got 201
    When I send the identical request again with Idempotency-Key "k"
    Then the response status is 201
    And the response carries `X-Idempotent-Replay: true`
    And only one cache rule exists

  @integration @rest @webhooks
  Scenario: An idempotency key on this family is unique within the organization
    Given I created a webhook endpoint with Idempotency-Key "k" and got 201
    When I send the identical request again with Idempotency-Key "k"
    Then the response status is 201
    And the response carries `X-Idempotent-Replay: true`
    And the replayed body carries the same signing secret as the first
    And the receipt is stored against the organization, not a project
    When I send a different body with Idempotency-Key "k"
    Then the response status is 409 and the code is `idempotency_error`
    # The secret is minted once and stored only as a hash, so a replay that
    # withheld it would hand back an endpoint nobody can verify.

  # ============================================================================
  # Refusals
  # ============================================================================

  @integration @rest
  Scenario: Reusing a key with a different body is refused
    Given I created a budget with Idempotency-Key "k" and got 201
    When I send a request with Idempotency-Key "k" and a changed limit
    Then the response status is 409 and the code is `idempotency_error`
    And `meta.reason` is "body_mismatch"
    And no second budget was created

  @integration @rest
  Scenario: A retry sent while the original is still running is refused
    Given a receipt for Idempotency-Key "k" that is claimed but not yet answered
    And it was claimed less than 60 seconds ago
    When I send the same request again with Idempotency-Key "k"
    Then the response status is 409 and the code is `idempotency_error`
    And `meta.reason` is "in_progress"
    And nothing new was created
    # The unique index on (scopeId, key) is what serialises the two retries;
    # without the claim going in first, both would find the key free.

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
  Scenario: A pending receipt older than the window is treated as a crash
    Given a receipt for Idempotency-Key "k" that is claimed but not yet answered
    And it was claimed more than 60 seconds ago
    When I send the same request again with Idempotency-Key "k"
    Then the response status is 201
    And the receipt now holds the new response
    # Without this the key stays locked for its full 24 hours whenever a
    # process dies between claiming the key and storing its answer, and the
    # caller can never complete the create it was trying to make.

  @integration @rest
  Scenario: An expired receipt lets the key be used again
    Given a receipt for Idempotency-Key "k" whose 24 hours have elapsed
    When I send the same request again with Idempotency-Key "k"
    Then the response status is 201
    And the response carries no X-Idempotent-Replay header
    And the lapsed receipt was replaced rather than left behind
