# Stuck states in the serving gate, the background runner and the reader (stuck-states review,
# section B). Each scenario is a way an upgrade could stop moving with nobody told what to do.
# Rulings: ARCHITECTURE.md section 7, "No stuck states" (STUCK-STATES).

Feature: An upgrade never sticks in the gate, the background runner or the status
  As an operator upgrading a LangWatch installation
  I want every failure to leave a way forward that the product names
  So that an upgrade never waits forever on something no Retry can clear

  # B1: the worker waits only on what a Retry can clear.
  @integration
  Scenario: A Retry of the failed blocking step frees the worker while another failed row stays
    Given a worker whose upgrade failed on a blocking step of its image
    And the ledger also records a failed step outside the image's blocking steps
    When the failed blocking step is retried
    Then the worker runs the upgrade again without waiting on the other failed row
    And it takes jobs once the upgrade succeeds

  # B3: an image that adds only background steps still registers them.
  @unit @integration
  Scenario: A worker runs the upgrade for a background step the ledger has not registered
    Given every blocking step the image declares is done
    And the image declares a background step the ledger has no row for
    When the worker's gate asks
    Then the worker is behind, naming the unregistered step
    And it runs the upgrade once, which registers the step, then takes jobs

  @unit
  Scenario: An api serves while a background step is unregistered
    Given every blocking step the image declares is done
    And the image declares a background step the ledger has no row for
    When the api's gate asks
    Then the api is admitted

  # B5: a run that failed after its steps settled (a reconciler) is not "up to date".
  @unit @integration
  Scenario: A failed last run with every step settled reads as needs attention
    Given every step in the ledger is done
    And the newest upgrade run ended failed
    When the upgrade status is read
    Then the installation needs attention, with the reason "failed-run"

  # B2: an admitted api answers a 500 that logs the disagreement (STUCK-STATES).
  @unit
  Scenario: A missing table on a ledger that says current is not reported as upgrading
    Given the api's gate has admitted it, so the ledger is current
    And the Postgres schema lacks a table the image reads
    When a request reads that table
    Then the api answers 500 internal_error, never "upgrade_in_progress"
    And the error it logs says "schema and ledger disagree" and names the table
    And before the gate admits, the same read answers 503 "upgrade_in_progress"

  # B1 tail: a failure with no failed step row backs off, never "waits for a Retry" (STUCK-STATES).
  @unit
  Scenario: A failed run with no failed step retries on a backoff, saying why
    Given a worker whose upgrade runs fail and leave no failed step row
    When it retries
    Then it waits 10 s, then 20 s, then 40 s, doubling up to at most 5 minutes
    And each line says it retries, in how long, and the run's last line of output
    And no line says it waits for a Retry

  # B4: a background step run has a 15-minute deadline (ARCHITECTURE.md §7, Alex 2026-10-10).
  @unit
  Scenario: A background step that never returns does not starve the steps after it
    Given a background step whose run neither finishes nor fails
    And a pending background step declared after it
    When the worker sweeps its background steps
    Then the later step still runs
    And the stuck step is reported once it passes its deadline
    And the stuck step is pending again with the checkpoint it saved before the deadline
    And a checkpoint the cut run saves after its deadline is refused

  @unit
  Scenario: A background step stops its compare-and-swap retries when its run is aborted
    Given the anomaly webhook destination migration retrying a rule edited on every write
    When its run is aborted
    Then it stops retrying and saves no page past the last completed one
    And it archives no endpoint, so a rerun reuses them by their keys

  @unit
  Scenario: A background step aborted before it polls starts no ClickHouse mutation
    Given the trace index materialisation step with no mutation recorded
    When its run is aborted before the first poll
    Then it starts no mutation and saves no progress

  # Follow-up to the planner fixes (stuck-states A): the Ops preview plans as the runner does.
  @integration
  Scenario: The preview plans a cut first install as fresh, as the runner does
    Given a seeded ledger whose only upgrade run planned a fresh install and failed
    And the ledger records schema below the LTS floor
    When the Upgrades page previews the upgrade
    Then the plan is a fresh install, not a refusal below the floor

  @integration
  Scenario: The preview reads the tools' records until a seed run has succeeded
    Given a ledger whose only seed run was cut before it finished
    And Prisma's history records every migration of the image's release
    When the Upgrades page previews the upgrade
    Then the installed release is read from Prisma's history
