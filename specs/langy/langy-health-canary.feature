Feature: A Langy health check that sends a real greeting and says what broke

  GET /api/health/langy exists for an external uptime monitor, not a person.
  It sends one real user turn, "Hi Langy.", through the same in-process turn
  service the browser and the key-authed API use, holds until that turn
  settles on the durable fold, and answers with a shape a monitor can alert
  on: 200 when Langy answered with text, 503 with a named `reason` when it did
  not, 429 when a check for the same caller is already in flight.

  Three unhealthy reasons exist, and only three: `timeout` (the turn did not
  settle inside the budget), `turn_failed` (the turn settled as failed or
  stopped), and `empty_reply` (the turn completed but carried no text). A
  failed, stopped or empty turn is never mistaken for a healthy one.

  The check mints a fresh idempotency key per run. Langy dedupes a repeated
  key per caller by replaying the first turn's outcome, so a monitor sending
  a fixed request body would stay green forever on the first answer; minting
  the key server-side is what lets a plain HTTP monitor, which sends the same
  request every time, drive a real turn every time.

  The budget is one attempt of 55 seconds. A plain HTTP monitor caps a single
  request at 60 seconds, and Langy's first turn on a cold worker is the
  slowest part of the path, so there is no room for a second attempt inside
  one request; the monitor's own confirmation retry covers the noise a single
  LLM turn carries. Every response the probe answers itself carries
  `Cache-Control: no-store`, so a monitor always sees the current turn's
  result rather than a cached one. The dark 404 is the one exception: it must
  be byte-identical to an unmounted path, headers included, or the header
  itself would reveal that the surface exists.

  It sits beside the other subsystem probes under /api/health, declared public
  like them and authenticating in-handler like them, and answers a refusal in
  their `{ message }` shape. The chain it authenticates with is the turn
  routes' own, in the same order, as POST /api/langy/conversations: a project
  API key resolves (else 401), the surface flag is open (else the same 404 an
  unmounted path gives), the key clears the `langy:create` ceiling (else 403),
  and the key's owner is in the Langy cohort (else 403). The turn runs as that
  owner. No new env var and no new credential class is involved.

  # Bindings:
  #   platform/app/src/server/health-probes/langy-canary.service.ts
  #   platform/app/src/server/health-probes/__tests__/langy-canary.service.unit.test.ts
  #   platform/app/src/server/app-layer/langy/langyApiKeyAuthorization.ts
  #   platform/app/src/server/routes/health-checks.ts
  #   platform/app/src/server/routes/__tests__/langy-canary.integration.test.ts

  # ---------------------------------------------------------------------------
  # Classification — what one settled turn means
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A completed turn with text is healthy
    Given a turn that settled as completed with a non-empty reply
    When the outcome is classified
    Then it is healthy

  @unit
  Scenario: A failed turn is turn_failed
    Given a turn that settled as failed
    When the outcome is classified
    Then it is unhealthy with reason "turn_failed"

  @unit
  Scenario: A stopped turn is turn_failed
    Given a turn that settled as stopped
    When the outcome is classified
    Then it is unhealthy with reason "turn_failed"

  @unit
  Scenario: A completed turn with only whitespace is empty_reply
    Given a turn that settled as completed with a reply of only whitespace
    When the outcome is classified
    Then it is unhealthy with reason "empty_reply"

  @unit
  Scenario: A turn that never settled is timeout
    Given no settlement arrived before the budget ran out
    When the outcome is classified
    Then it is unhealthy with reason "timeout"

  # ---------------------------------------------------------------------------
  # Orchestration — one run, one budget, one fresh key
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every run starts its turn with a fresh idempotency key
    Given two consecutive canary runs
    When each starts its turn
    Then the two idempotency keys differ
    And each is a UUID

  @unit
  Scenario: A healthy run reports the ids of the turn it sent
    Given a turn that starts and settles as completed with text
    When the canary runs
    Then it is healthy
    And it reports that turn's conversation id and turn id
    And it reports how long the run took

  @unit
  Scenario: A turn that does not settle inside the budget is timeout
    Given a turn that starts but never settles
    When the budget elapses
    Then the run is unhealthy with reason "timeout"
    And the settlement wait was aborted

  @unit
  Scenario: A settlement wait that ignores its signal is still timeout
    Given a turn that starts and a settlement wait that never resolves, aborted or not
    When the budget elapses
    Then the run is unhealthy with reason "timeout" inside the budget

  @unit
  Scenario: A turn that cannot even start is turn_failed
    Given the turn service throws when the turn is started
    When the canary runs
    Then the run is unhealthy with reason "turn_failed"
    And it reports no conversation id

  @unit
  Scenario: A turn start that hangs is bounded by the same budget
    Given the turn service never returns from starting the turn
    When the budget elapses
    Then the run is unhealthy with reason "timeout"

  @unit
  Scenario: The production turn is the greeting, sent as the key's owner
    Given the project and session the auth chain resolved
    When the production deps start the turn
    Then the turn service receives one user message "Hi Langy."
    And no conversation id is requested
    And the turn is attributed to that session
    When the production deps await settlement
    Then the fold is followed as that session's user

  # ---------------------------------------------------------------------------
  # Single flight — one check per caller at a time
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A second check for the same caller while one is in flight is busy
    Given a canary run in flight for one caller
    When a second check arrives for the same caller
    Then the second check is told the probe is busy
    And no second turn is started

  @unit
  Scenario: Checks for different callers do not block each other
    Given a canary run in flight for one caller
    When a check arrives for a different caller
    Then that check runs

  @unit
  Scenario: The guard releases once the run settles
    Given a canary run that has settled for one caller
    When a new check arrives for the same caller
    Then that check runs

  @unit
  Scenario: A check arriving straight after a timeout is busy
    Given a canary run for one caller that answered "timeout"
    When a new check arrives for the same caller inside one budget
    Then that check is told the probe is busy
    And no second turn is started

  @unit
  Scenario: The reservation a timeout takes lapses after one budget
    Given a canary run for one caller that answered "timeout"
    When a new check arrives for the same caller after one budget
    Then that check runs

  @unit
  Scenario: A timeout for one caller does not reserve another caller
    Given a canary run for one caller that answered "timeout"
    When a check arrives for a different caller inside one budget
    Then that check runs

  @unit
  Scenario: A settled unhealthy run that is not a timeout reserves nothing
    Given a canary run for one caller that answered "turn_failed"
    When a new check arrives for the same caller inside one budget
    Then that check runs

  # ---------------------------------------------------------------------------
  # Route — GET /api/health/langy
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A request with no credential is refused before any turn is started
    Given a request carrying no project API key
    When GET /api/health/langy is called
    Then the response is 401
    And no turn is started

  @unit
  Scenario: A switched-off surface answers the health check as a route that does not exist
    Given the Langy API surface flag is off for the key's project
    When GET /api/health/langy is called with a valid key
    Then the response is byte-identical to an unmounted path's 404, headers included
    And no turn is started

  @unit
  Scenario: A key without langy:create is refused
    Given a project API key that does not clear the langy:create ceiling
    When GET /api/health/langy is called
    Then the response is 403
    And no turn is started

  @unit
  Scenario: A key whose owner is outside the Langy cohort is refused
    Given a project API key owned by a user without Langy access
    When GET /api/health/langy is called
    Then the response is 403 with the denial's message, in the shape the sibling probes use
    And no turn is started

  @unit
  Scenario: A healthy run answers 200 with the turn's ids
    Given the canary reports healthy
    When GET /api/health/langy is called with a valid key
    Then the response is 200 with status "ok"
    And the body carries the conversation id, turn id and duration

  @unit
  Scenario: An unhealthy run answers 503 with its reason
    Given the canary reports unhealthy with reason "empty_reply"
    When GET /api/health/langy is called with a valid key
    Then the response is 503 with status "unhealthy"
    And the body carries the reason "empty_reply"

  @unit
  Scenario: A busy probe answers 429
    Given the canary reports busy
    When GET /api/health/langy is called with a valid key
    Then the response is 429 with status "busy"

  @unit
  Scenario: Every health response is uncacheable
    Given any outcome from the canary
    When GET /api/health/langy is called
    Then the response carries "Cache-Control: no-store"

  @unit
  Scenario: The Langy probe is declared public like its sibling health probes
    Given the health-checks app is loaded
    When the route registry is read for GET /api/health/langy
    Then its policy is public, the key being authenticated in-handler
    And it matches the policy of GET /api/health/scenarios

  # ---------------------------------------------------------------------------
  # Live proof — against a running stack, before the monitor is trusted
  # ---------------------------------------------------------------------------

  @e2e @unimplemented
  Scenario: The check goes green and red against a running stack
    Given a running stack with the Langy API surface open for one project
    And a project API key owned by a user in the Langy cohort
    When GET /api/health/langy is called with that key
    Then the response is 200 within 60 seconds and the reply text is logged
    When the Langy worker is made unreachable and the check is called again
    Then the response is 503 with reason "timeout" or "turn_failed"
    And the latency of both calls is recorded on the issue
