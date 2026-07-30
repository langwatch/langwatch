Feature: The unclaimed ramp — 7 days of ingest, 30 days to claim, then gone
  As a developer who let an agent provision an account for me
  I want a clear, stated deadline rather than a surprise
  So that I know exactly how long my data lives and what claiming buys me.

  A soft ramp, not a cliff. Ingestion stops at day 7 while the data stays
  readable and claimable to day 30. The day-7 stop is deliberate: the moment
  the traces stop arriving is the moment the developer notices, and by then
  they have used the product for a week.

  Pairs with:
    - specs/ai-governance/agent-onboarding/provisioning.feature
    - specs/ai-governance/agent-onboarding/claim-handoff.feature

  Background:
    Given an ephemeral account provisioned at day 0

  # ─────────────────────────────────────────────────────────────────────
  # States
  # ─────────────────────────────────────────────────────────────────────

  @bdd @lifecycle
  Scenario Outline: the account reports its state from the two deadlines
    Given it is day <day>
    When the CLI GETs `/status` with the claim token
    Then the state is `<state>`
    And the response says how many days remain in the current phase

    Examples:
      | day | state       |
      | 0   | active      |
      | 6   | active      |
      | 7   | read_only   |
      | 29  | read_only   |
      | 30  | expired     |

  @bdd @lifecycle
  Scenario: a claimed account has no deadlines at all
    Given the account was claimed
    When the CLI GETs `/status`
    Then the state is `claimed`
    And no deadline is reported

  @bdd @lifecycle
  Scenario: state is derived from the timestamps, never stored as a field
    Then the state is computed from `ingestionStopsAt`, `deleteAfter` and `claimedAt`
    And no background job is required for the state to be correct
    # a stored state field is a second source of truth that goes stale the
    # moment a job is late, and this one is read by a CLI that shows a
    # countdown.

  @bdd @lifecycle
  Scenario: `/status` does not leak an account to whoever asks
    When a caller GETs `/status` with a claim token that is not theirs
    Then the response is the same not-found answer as for an unknown token

  # ─────────────────────────────────────────────────────────────────────
  # What each phase means
  # ─────────────────────────────────────────────────────────────────────

  @bdd @lifecycle
  Scenario: ingestion is refused once the account is read-only
    Given it is day 8 and the account is unclaimed
    When the agent exports traces with its ingestion key
    Then the export is refused
    And the data already collected is still readable

  @bdd @lifecycle
  Scenario: claiming during the read-only window restores ingestion
    Given it is day 8 and the account is unclaimed
    When the developer claims it
    Then ingestion is accepted again on the same key

  @bdd @lifecycle
  Scenario: an expired account is gone from every store
    Given it is past day 30 and the account was never claimed
    Then the Postgres rows are deleted
    And the ClickHouse tenant data is deleted
    And any stored objects are deleted
    # a hard delete across all three stores is what makes the free tier a
    # clean answer to a data-retention question rather than a liability.

  @bdd @lifecycle
  Scenario: the reaper never touches a claimed account
    Given an account was claimed on day 3
    When the reaper runs on day 31
    Then that account is not selected

  @bdd @lifecycle
  Scenario: the reaper is driven by the deadline, not by a queue
    Then selecting accounts to delete is a query over `deleteAfter`
    And a missed run is caught up by the next one
    # a durable queue entry per account would need its own reconciliation;
    # the deadline column already is the work list.

  # ─────────────────────────────────────────────────────────────────────
  # Telling the developer
  # ─────────────────────────────────────────────────────────────────────

  @bdd @lifecycle @copy
  Scenario: provisioning states both deadlines in words the CLI can print
    When the account is provisioned
    Then the response carries copy stating the data is viewable for 7 days
    And copy stating the account is claimable for 30 days
    And copy stating what happens after that

  @bdd @lifecycle @copy
  Scenario: the copy never mentions how any of it is built
    Then no user-facing string names Postgres, ClickHouse, Redis or a reaper
    # see dev/docs/best_practices/copywriting.md — copy says what the
    # feature does for the customer, never how it is built.
